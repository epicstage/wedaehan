-- The Challenge 100 팀빌딩 시스템 스키마

-- 이벤트 설정
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  phase TEXT DEFAULT 'setup',  -- 'setup' | 'voting' | 'leader_selection' | 'team_forming' | 'confirmed'
  created_at TEXT DEFAULT (datetime('now'))
);

-- 참가자
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  problem_tag TEXT,  -- 관심 문제 태그
  is_leader INTEGER DEFAULT 0,  -- 리더로 선정되었는지
  vote_count INTEGER DEFAULT 0,  -- 받은 투표 수
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- 투표 (참가자가 리더 후보에게 투표)
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,      -- 투표한 사람
  candidate_id INTEGER NOT NULL,  -- 리더 후보
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, voter_id, candidate_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (voter_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- 팀
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  leader_id INTEGER NOT NULL,
  problem_tag TEXT,
  team_name TEXT,
  status TEXT DEFAULT 'forming',  -- 'forming' | 'confirmed'
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (leader_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- 팀 멤버
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',  -- 'leader' | 'member'
  joined_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_id, participant_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_participants_problem ON participants(event_id, problem_tag);
CREATE INDEX IF NOT EXISTS idx_votes_event ON votes(event_id);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(event_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
