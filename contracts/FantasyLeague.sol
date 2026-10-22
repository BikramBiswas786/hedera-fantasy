// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FantasyLeague
/// @notice Dream11-style daily fantasy contests (cricket and football), with
///         every rule enforced on-chain:
///         - squads, player roles and credits are published on-chain before the match
///         - team rules (11 players, 100 credits, max 7 per side, role limits) are validated by the contract
///         - teams and entries lock automatically at match start time
///         - per-player fantasy points are posted with a hash of the raw stats (published on HCS),
///           so anyone can recompute them with the open-source scoring code
///         - team scores are computed by the contract, and settlement verifies the submitted
///           ranking, so nobody (including the operator) can change who wins
///         Entry fees, sponsored pools and prizes are paid in the native coin (HBAR on Hedera).
///         Inside the Hedera EVM, msg.value and all amounts here are in tinybars (1 HBAR = 1e8).
contract FantasyLeague is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint8 public constant TEAM_SIZE = 11;
    uint16 public constant MAX_CREDITS = 1000; // 100.0 credits, stored in tenths
    uint8 public constant MAX_PER_SIDE = 7;
    uint8 public constant MAX_TEAMS_PER_MATCH = 20;
    uint8 public constant ROLE_COUNT = 4;
    uint16 public constant BPS = 10_000;

    enum Sport {
        Cricket,
        Football
    }

    enum MatchStatus {
        Scheduled,
        ResultsPosted,
        Abandoned
    }

    enum ContestStatus {
        Open,
        Settled,
        Cancelled
    }

    /// @dev Cricket roles: 0 WK, 1 BAT, 2 AR, 3 BOWL. Football roles: 0 GK, 1 DEF, 2 MID, 3 FWD.
    struct Player {
        uint8 side; // 0 = home, 1 = away
        uint8 role;
        uint8 credits; // tenths, e.g. 85 = 8.5 credits
    }

    struct Match {
        Sport sport;
        MatchStatus status;
        uint64 startTime;
        uint64 resultsPostedAt;
        uint32 settledContests;
        bytes32 rulesHash; // keccak256 of the scoring rules file used for this match
        bytes32 statsHash; // keccak256 of the canonical raw stats JSON
        string name;
        string metadataURI; // player names, team names, etc.
        string statsRef; // where the raw stats were published (e.g. HCS topic + sequence number)
    }

    struct Team {
        address owner;
        uint256 matchId;
        uint8[11] picks; // indices into the match's player list
        uint8 captain; // player index, 2x points
        uint8 viceCaptain; // player index, 1.5x points
    }

    struct ContestParams {
        uint256 matchId;
        uint256 entryFee;
        uint256 sponsoredPool;
        uint32 maxEntries;
        uint32 minEntries;
        uint8 maxEntriesPerUser;
        uint16 platformFeeBps;
        uint16[] prizeBps; // share of the pool per rank, must sum to 10000 and be non-increasing
    }

    struct Contest {
        uint256 matchId;
        uint256 entryFee;
        uint256 sponsoredPool;
        address sponsor;
        uint32 maxEntries;
        uint32 minEntries;
        uint8 maxEntriesPerUser;
        uint16 platformFeeBps;
        ContestStatus status;
        uint16[] prizeBps;
    }

    struct Entry {
        address user;
        uint256 teamId;
    }

    address public treasury;
    uint64 public disputeWindow;

    uint8[ROLE_COUNT][2] public roleMin;
    uint8[ROLE_COUNT][2] public roleMax;

    uint256 public matchCount;
    uint256 public teamCount;
    uint256 public contestCount;

    mapping(uint256 => Match) internal _matches;
    mapping(uint256 => Player[]) internal _players;
    mapping(uint256 => int32[]) internal _points; // tenths of a point, per player index
    mapping(uint256 => Team) internal _teams;
    mapping(uint256 => mapping(address => uint256[])) internal _teamsOf;
    mapping(uint256 => Contest) internal _contests;
    mapping(uint256 => Entry[]) internal _entries;
    mapping(uint256 => mapping(address => uint8)) public userEntryCount;
    mapping(uint256 => mapping(uint256 => bool)) public teamInContest;
    mapping(uint256 => uint256[]) internal _contestsOfMatch;
    mapping(address => uint256) public claimable;

    event MatchCreated(uint256 indexed matchId, Sport sport, string name, uint64 startTime, bytes32 rulesHash, string metadataURI);
    event TeamSaved(uint256 indexed teamId, uint256 indexed matchId, address indexed owner, uint8[11] picks, uint8 captain, uint8 viceCaptain);
    event ContestCreated(uint256 indexed contestId, uint256 indexed matchId, uint256 entryFee, uint256 sponsoredPool, uint32 maxEntries, uint16[] prizeBps);
    event ContestJoined(uint256 indexed contestId, uint256 indexed entryIndex, address indexed user, uint256 teamId);
    event ResultsPosted(uint256 indexed matchId, bytes32 statsHash, string statsRef, int32[] points);
    event MatchAbandoned(uint256 indexed matchId);
    event EntryRanked(uint256 indexed contestId, uint256 indexed entryIndex, address indexed user, uint256 rank, int256 score, uint256 prize);
    event ContestSettled(uint256 indexed contestId, uint256 prizePool, uint256 platformFee);
    event ContestCancelled(uint256 indexed contestId);
    event Claimed(address indexed user, uint256 amount);

    constructor(address treasury_, uint64 disputeWindow_) {
        treasury = treasury_;
        disputeWindow = disputeWindow_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);

        // Cricket: 1-8 of each of WK, BAT, AR, BOWL
        roleMin[uint8(Sport.Cricket)] = [1, 1, 1, 1];
        roleMax[uint8(Sport.Cricket)] = [8, 8, 8, 8];
        // Football: 1 GK, 3-5 DEF, 3-5 MID, 1-3 FWD
        roleMin[uint8(Sport.Football)] = [1, 3, 3, 1];
        roleMax[uint8(Sport.Football)] = [1, 5, 5, 3];
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = treasury_;
    }

    function setDisputeWindow(uint64 disputeWindow_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        disputeWindow = disputeWindow_;
    }

    // ---------------------------------------------------------------------
    // Matches
    // ---------------------------------------------------------------------

    function createMatch(
        Sport sport,
        string calldata name,
        uint64 startTime,
        Player[] calldata players,
        bytes32 rulesHash,
        string calldata metadataURI
    ) external onlyRole(OPERATOR_ROLE) returns (uint256 matchId) {
        require(startTime > block.timestamp, "Match: start in past");
        require(players.length >= 2 * TEAM_SIZE && players.length <= 255, "Match: bad squad size");

        matchId = ++matchCount;
        Match storage m = _matches[matchId];
        m.sport = sport;
        m.startTime = startTime;
        m.rulesHash = rulesHash;
        m.name = name;
        m.metadataURI = metadataURI;

        Player[] storage squad = _players[matchId];
        for (uint256 i = 0; i < players.length; i++) {
            require(players[i].side < 2 && players[i].role < ROLE_COUNT, "Match: bad player");
            squad.push(players[i]);
        }
        emit MatchCreated(matchId, sport, name, startTime, rulesHash, metadataURI);
    }

    /// @notice Post per-player fantasy points after the match. Can be corrected until the
    ///         dispute window ends; every version is emitted as an event.
    function postResults(uint256 matchId, int32[] calldata points, bytes32 statsHash, string calldata statsRef)
        external
        onlyRole(ORACLE_ROLE)
    {
        Match storage m = _matches[matchId];
        require(m.startTime != 0, "Match: unknown");
        require(m.status != MatchStatus.Abandoned, "Match: abandoned");
        require(block.timestamp >= m.startTime, "Match: not started");
        require(m.settledContests == 0, "Match: already settled");
        if (m.status == MatchStatus.ResultsPosted) {
            require(block.timestamp < m.resultsPostedAt + disputeWindow, "Match: results final");
        }
        require(points.length == _players[matchId].length, "Match: points length");

        _points[matchId] = points;
        m.status = MatchStatus.ResultsPosted;
        m.resultsPostedAt = uint64(block.timestamp);
        m.statsHash = statsHash;
        m.statsRef = statsRef;
        emit ResultsPosted(matchId, statsHash, statsRef, points);
    }

    function abandonMatch(uint256 matchId) external onlyRole(OPERATOR_ROLE) {
        Match storage m = _matches[matchId];
        require(m.startTime != 0, "Match: unknown");
        require(m.settledContests == 0, "Match: already settled");
        m.status = MatchStatus.Abandoned;
        emit MatchAbandoned(matchId);
    }

    // ---------------------------------------------------------------------
    // Teams
    // ---------------------------------------------------------------------

    function createTeam(uint256 matchId, uint8[11] calldata picks, uint8 captain, uint8 viceCaptain)
        external
        returns (uint256 teamId)
    {
        require(_teamsOf[matchId][msg.sender].length < MAX_TEAMS_PER_MATCH, "Team: limit reached");
        _validateTeam(matchId, picks, captain, viceCaptain);

        teamId = ++teamCount;
        _teams[teamId] = Team(msg.sender, matchId, picks, captain, viceCaptain);
        _teamsOf[matchId][msg.sender].push(teamId);
        emit TeamSaved(teamId, matchId, msg.sender, picks, captain, viceCaptain);
    }

    /// @notice Edit a team until the match starts. Contests it has joined use the edited team.
    function editTeam(uint256 teamId, uint8[11] calldata picks, uint8 captain, uint8 viceCaptain) external {
        Team storage t = _teams[teamId];
        require(t.owner == msg.sender, "Team: not owner");
        _validateTeam(t.matchId, picks, captain, viceCaptain);

        t.picks = picks;
        t.captain = captain;
        t.viceCaptain = viceCaptain;
        emit TeamSaved(teamId, t.matchId, msg.sender, picks, captain, viceCaptain);
    }

    function _validateTeam(uint256 matchId, uint8[11] calldata picks, uint8 captain, uint8 viceCaptain) internal view {
        Match storage m = _matches[matchId];
        require(m.startTime != 0, "Team: unknown match");
        require(m.status == MatchStatus.Scheduled && block.timestamp < m.startTime, "Team: deadline passed");
        require(captain != viceCaptain, "Team: C and VC same");

        Player[] storage squad = _players[matchId];
        uint256 credits;
        uint8[2] memory perSide;
        uint8[ROLE_COUNT] memory perRole;
        bool hasCaptain;
        bool hasVice;
        uint256 seenLo; // bitmap of player indices 0-127
        uint256 seenHi; // bitmap of player indices 128-255

        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            uint8 idx = picks[i];
            require(idx < squad.length, "Team: bad player");
            if (idx < 128) {
                require(seenLo & (1 << idx) == 0, "Team: duplicate player");
                seenLo |= 1 << idx;
            } else {
                require(seenHi & (1 << (idx - 128)) == 0, "Team: duplicate player");
                seenHi |= 1 << (idx - 128);
            }
            Player storage p = squad[idx];
            credits += p.credits;
            perSide[p.side]++;
            perRole[p.role]++;
            if (idx == captain) hasCaptain = true;
            if (idx == viceCaptain) hasVice = true;
        }

        require(hasCaptain && hasVice, "Team: C/VC not in team");
        require(credits <= MAX_CREDITS, "Team: over credits");
        require(perSide[0] <= MAX_PER_SIDE && perSide[1] <= MAX_PER_SIDE, "Team: max 7 per side");
        uint8 s = uint8(m.sport);
        for (uint8 r = 0; r < ROLE_COUNT; r++) {
            require(perRole[r] >= roleMin[s][r] && perRole[r] <= roleMax[s][r], "Team: role limits");
        }
    }

    // ---------------------------------------------------------------------
    // Contests
    // ---------------------------------------------------------------------

    /// @notice Create a contest. The operator funds `sponsoredPool` by sending exactly that much HBAR.
    function createContest(ContestParams calldata p) external payable onlyRole(OPERATOR_ROLE) returns (uint256 contestId) {
        Match storage m = _matches[p.matchId];
        require(m.startTime != 0 && m.status == MatchStatus.Scheduled, "Contest: bad match");
        require(block.timestamp < m.startTime, "Contest: match started");
        require(p.maxEntries >= 2 && p.minEntries >= 1 && p.minEntries <= p.maxEntries, "Contest: bad size");
        require(p.maxEntriesPerUser >= 1, "Contest: bad per-user limit");
        require(p.platformFeeBps <= 2_000, "Contest: fee too high");
        require(p.prizeBps.length >= 1 && p.prizeBps.length <= p.maxEntries, "Contest: bad prizes");

        uint256 total;
        for (uint256 i = 0; i < p.prizeBps.length; i++) {
            if (i > 0) require(p.prizeBps[i] <= p.prizeBps[i - 1], "Contest: prizes must not increase");
            total += p.prizeBps[i];
        }
        require(total == BPS, "Contest: prizes must sum to 100%");

        require(msg.value == p.sponsoredPool, "Contest: send sponsored pool");

        contestId = ++contestCount;
        Contest storage c = _contests[contestId];
        c.matchId = p.matchId;
        c.entryFee = p.entryFee;
        c.sponsoredPool = p.sponsoredPool;
        c.sponsor = msg.sender;
        c.maxEntries = p.maxEntries;
        c.minEntries = p.minEntries;
        c.maxEntriesPerUser = p.maxEntriesPerUser;
        c.platformFeeBps = p.platformFeeBps;
        c.prizeBps = p.prizeBps;
        _contestsOfMatch[p.matchId].push(contestId);
        emit ContestCreated(contestId, p.matchId, p.entryFee, p.sponsoredPool, p.maxEntries, p.prizeBps);
    }

    /// @notice Join a contest by sending exactly the entry fee in HBAR (0 for free contests).
    function joinContest(uint256 contestId, uint256 teamId) external payable nonReentrant {
        Contest storage c = _contests[contestId];
        Team storage t = _teams[teamId];
        Match storage m = _matches[c.matchId];
        require(c.matchId != 0 && c.status == ContestStatus.Open, "Join: contest closed");
        require(m.status == MatchStatus.Scheduled && block.timestamp < m.startTime, "Join: deadline passed");
        require(t.owner == msg.sender, "Join: not your team");
        require(t.matchId == c.matchId, "Join: wrong match");
        require(!teamInContest[contestId][teamId], "Join: team already joined");
        require(_entries[contestId].length < c.maxEntries, "Join: contest full");
        require(userEntryCount[contestId][msg.sender] < c.maxEntriesPerUser, "Join: entry limit");

        teamInContest[contestId][teamId] = true;
        userEntryCount[contestId][msg.sender]++;
        _entries[contestId].push(Entry(msg.sender, teamId));
        require(msg.value == c.entryFee, "Join: wrong entry fee");
        emit ContestJoined(contestId, _entries[contestId].length - 1, msg.sender, teamId);
    }

    /// @notice Settle a contest. Anyone can call this once results are final. The caller
    ///         supplies the ranking (entry indices, best first); the contract recomputes every
    ///         score and rejects the call unless the ranking is complete and correctly ordered.
    ///         Tied entries split the prizes for the ranks they share, as on Dream11.
    function settleContest(uint256 contestId, uint32[] calldata ranking) external nonReentrant {
        Contest storage c = _contests[contestId];
        Match storage m = _matches[c.matchId];
        require(c.matchId != 0 && c.status == ContestStatus.Open, "Settle: not open");
        require(m.status == MatchStatus.ResultsPosted, "Settle: no results");
        require(block.timestamp >= m.resultsPostedAt + disputeWindow, "Settle: dispute window");

        Entry[] storage entries = _entries[contestId];
        uint256 n = entries.length;
        require(n >= c.minEntries, "Settle: under-filled, cancel instead");
        require(ranking.length == n, "Settle: ranking length");

        int256[] memory scores = new int256[](n);
        bool[] memory seen = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            uint32 e = ranking[i];
            require(e < n && !seen[e], "Settle: bad ranking");
            seen[e] = true;
            scores[i] = scoreOfTeam(entries[e].teamId);
            if (i > 0) require(scores[i] <= scores[i - 1], "Settle: ranking not sorted");
        }

        uint256 collected = c.entryFee * n;
        uint256 platformFee = (collected * c.platformFeeBps) / BPS;
        uint256 pool = collected - platformFee + c.sponsoredPool;
        uint256 paid = _distribute(contestId, ranking, scores, pool);

        // platform fee plus rounding dust
        claimable[treasury] += platformFee + (pool - paid);
        c.status = ContestStatus.Settled;
        m.settledContests++;
        emit ContestSettled(contestId, pool, platformFee);
    }

    /// @dev Credits prizes by rank. Tied entries share the prizes of the ranks they occupy.
    function _distribute(uint256 contestId, uint32[] calldata ranking, int256[] memory scores, uint256 pool)
        internal
        returns (uint256 paid)
    {
        uint16[] storage prizeBps = _contests[contestId].prizeBps;
        Entry[] storage entries = _entries[contestId];
        uint256 n = ranking.length;
        uint256 start = 0;
        while (start < n) {
            uint256 end = start;
            while (end + 1 < n && scores[end + 1] == scores[start]) end++;

            uint256 shareBps;
            for (uint256 r = start; r <= end && r < prizeBps.length; r++) shareBps += prizeBps[r];
            uint256 each = (pool * shareBps) / BPS / (end - start + 1);

            for (uint256 i = start; i <= end; i++) {
                address user = entries[ranking[i]].user;
                if (each > 0) claimable[user] += each;
                paid += each;
                emit EntryRanked(contestId, ranking[i], user, start + 1, scores[i], each);
            }
            start = end + 1;
        }
    }

    /// @notice Cancel and refund a contest. Anyone can call this if the match was abandoned,
    ///         or if the contest did not reach its minimum entries by the deadline.
    function cancelContest(uint256 contestId) external nonReentrant {
        Contest storage c = _contests[contestId];
        Match storage m = _matches[c.matchId];
        require(c.matchId != 0 && c.status == ContestStatus.Open, "Cancel: not open");
        Entry[] storage entries = _entries[contestId];
        bool underFilled = block.timestamp >= m.startTime && entries.length < c.minEntries;
        require(m.status == MatchStatus.Abandoned || underFilled, "Cancel: not allowed");

        c.status = ContestStatus.Cancelled;
        for (uint256 i = 0; i < entries.length; i++) claimable[entries[i].user] += c.entryFee;
        claimable[c.sponsor] += c.sponsoredPool;
        emit ContestCancelled(contestId);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Claim: nothing to claim");
        claimable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Claim: transfer failed");
        emit Claimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Team score in hundredths of a point (captain 2x, vice-captain 1.5x).
    function scoreOfTeam(uint256 teamId) public view returns (int256 score) {
        Team storage t = _teams[teamId];
        int32[] storage pts = _points[t.matchId];
        if (pts.length == 0) return 0;
        for (uint256 i = 0; i < TEAM_SIZE; i++) {
            uint8 idx = t.picks[i];
            int256 mult = idx == t.captain ? int256(20) : idx == t.viceCaptain ? int256(15) : int256(10);
            score += int256(pts[idx]) * mult;
        }
    }

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return _matches[matchId];
    }

    function getPlayers(uint256 matchId) external view returns (Player[] memory) {
        return _players[matchId];
    }

    function getPoints(uint256 matchId) external view returns (int32[] memory) {
        return _points[matchId];
    }

    function getTeam(uint256 teamId) external view returns (Team memory) {
        return _teams[teamId];
    }

    function getTeamsOf(uint256 matchId, address user) external view returns (uint256[] memory) {
        return _teamsOf[matchId][user];
    }

    function getContest(uint256 contestId) external view returns (Contest memory) {
        return _contests[contestId];
    }

    function getEntries(uint256 contestId) external view returns (Entry[] memory) {
        return _entries[contestId];
    }

    function getContestsOfMatch(uint256 matchId) external view returns (uint256[] memory) {
        return _contestsOfMatch[matchId];
    }
}
