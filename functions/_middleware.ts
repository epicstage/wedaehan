import { Hono } from 'hono';

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// CORS 미들웨어
app.use('*', async (c, next) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  await next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.res.headers.set(key, value);
  });
});

// ============ 이벤트 API ============

// 이벤트 목록 조회
app.get('/api/events', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT * FROM events ORDER BY created_at DESC').all();
    return c.json({ success: true, events: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 이벤트 상세 조회
app.get('/api/events/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!event) {
      return c.json({ success: false, error: '이벤트를 찾을 수 없습니다.' }, 404);
    }
    return c.json({ success: true, event });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 이벤트 생성
app.post('/api/events', async (c) => {
  try {
    const body = await c.req.json();
    const { name, description } = body;

    const result = await c.env.DB.prepare(
      'INSERT INTO events (name, description) VALUES (?, ?)'
    ).bind(name, description || '').run();

    return c.json({ success: true, message: '이벤트가 생성되었습니다.' });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 이벤트 단계 변경
app.patch('/api/events/:id/phase', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json();
    const { phase } = body;

    const validPhases = ['setup', 'voting', 'leader_selection', 'team_forming', 'confirmed'];
    if (!validPhases.includes(phase)) {
      return c.json({ success: false, error: '유효하지 않은 단계입니다.' }, 400);
    }

    await c.env.DB.prepare('UPDATE events SET phase = ? WHERE id = ?').bind(phase, id).run();
    return c.json({ success: true, message: `단계가 ${phase}로 변경되었습니다.` });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============ 참가자 API ============

// 참가자 목록 조회
app.get('/api/events/:eventId/participants', async (c) => {
  const eventId = c.req.param('eventId');
  const problemTag = c.req.query('problem_tag');

  try {
    let query = 'SELECT * FROM participants WHERE event_id = ?';
    const params: any[] = [eventId];

    if (problemTag) {
      query += ' AND problem_tag = ?';
      params.push(problemTag);
    }

    query += ' ORDER BY vote_count DESC, name ASC';

    const stmt = c.env.DB.prepare(query);
    const result = await stmt.bind(...params).all();
    return c.json({ success: true, participants: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 참가자 상세 조회
app.get('/api/events/:eventId/participants/:id', async (c) => {
  const eventId = c.req.param('eventId');
  const id = c.req.param('id');

  try {
    const participant = await c.env.DB.prepare(
      'SELECT * FROM participants WHERE id = ? AND event_id = ?'
    ).bind(id, eventId).first();

    if (!participant) {
      return c.json({ success: false, error: '참가자를 찾을 수 없습니다.' }, 404);
    }
    return c.json({ success: true, participant });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 참가자 CSV Import
app.post('/api/events/:eventId/participants/import', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    const body = await c.req.json();
    const { participants } = body;

    if (!Array.isArray(participants) || participants.length === 0) {
      return c.json({ success: false, error: '참가자 데이터가 필요합니다.' }, 400);
    }

    let imported = 0;
    for (const p of participants) {
      await c.env.DB.prepare(
        'INSERT INTO participants (event_id, name, company, email, phone, problem_tag) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(eventId, p.name, p.company || '', p.email || '', p.phone || '', p.problem_tag || '').run();
      imported++;
    }

    return c.json({ success: true, message: `${imported}명의 참가자가 등록되었습니다.`, count: imported });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 문제 태그 목록 조회
app.get('/api/events/:eventId/problem-tags', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    const result = await c.env.DB.prepare(
      'SELECT problem_tag, COUNT(*) as count FROM participants WHERE event_id = ? AND problem_tag IS NOT NULL AND problem_tag != "" GROUP BY problem_tag ORDER BY count DESC'
    ).bind(eventId).all();

    return c.json({ success: true, tags: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============ 투표 API ============

// 투표하기 (최대 3표)
app.post('/api/events/:eventId/votes', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    const body = await c.req.json();
    const { voter_id, candidate_ids } = body;

    if (!voter_id || !Array.isArray(candidate_ids)) {
      return c.json({ success: false, error: '투표자 ID와 후보자 ID 배열이 필요합니다.' }, 400);
    }

    if (candidate_ids.length > 3) {
      return c.json({ success: false, error: '최대 3표까지만 투표할 수 있습니다.' }, 400);
    }

    // 자기 자신에게 투표 불가
    if (candidate_ids.includes(voter_id)) {
      return c.json({ success: false, error: '자기 자신에게는 투표할 수 없습니다.' }, 400);
    }

    // 같은 문제 태그 그룹인지 확인
    const voter = await c.env.DB.prepare(
      'SELECT problem_tag FROM participants WHERE id = ? AND event_id = ?'
    ).bind(voter_id, eventId).first() as { problem_tag: string } | null;

    if (!voter) {
      return c.json({ success: false, error: '투표자를 찾을 수 없습니다.' }, 404);
    }

    // 기존 투표 삭제
    await c.env.DB.prepare(
      'DELETE FROM votes WHERE event_id = ? AND voter_id = ?'
    ).bind(eventId, voter_id).run();

    // 새 투표 등록
    for (const candidateId of candidate_ids) {
      // 같은 그룹인지 확인
      const candidate = await c.env.DB.prepare(
        'SELECT problem_tag FROM participants WHERE id = ? AND event_id = ?'
      ).bind(candidateId, eventId).first() as { problem_tag: string } | null;

      if (!candidate || candidate.problem_tag !== voter.problem_tag) {
        return c.json({ success: false, error: '같은 문제 태그 그룹의 참가자에게만 투표할 수 있습니다.' }, 400);
      }

      await c.env.DB.prepare(
        'INSERT INTO votes (event_id, voter_id, candidate_id) VALUES (?, ?, ?)'
      ).bind(eventId, voter_id, candidateId).run();
    }

    // 득표 수 업데이트
    await c.env.DB.prepare(`
      UPDATE participants SET vote_count = (
        SELECT COUNT(*) FROM votes WHERE candidate_id = participants.id AND event_id = ?
      ) WHERE event_id = ?
    `).bind(eventId, eventId).run();

    return c.json({ success: true, message: '투표가 완료되었습니다.' });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 내 투표 현황 조회
app.get('/api/events/:eventId/votes/:voterId', async (c) => {
  const eventId = c.req.param('eventId');
  const voterId = c.req.param('voterId');

  try {
    const result = await c.env.DB.prepare(
      'SELECT candidate_id FROM votes WHERE event_id = ? AND voter_id = ?'
    ).bind(eventId, voterId).all();

    const candidateIds = result.results.map((v: any) => v.candidate_id);
    return c.json({ success: true, voted_for: candidateIds });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 투표 결과 (문제 태그별)
app.get('/api/events/:eventId/votes/results', async (c) => {
  const eventId = c.req.param('eventId');
  const problemTag = c.req.query('problem_tag');

  try {
    let query = `
      SELECT p.*,
        (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = p.id AND v.event_id = ?) as vote_count
      FROM participants p
      WHERE p.event_id = ?
    `;
    const params: any[] = [eventId, eventId];

    if (problemTag) {
      query += ' AND p.problem_tag = ?';
      params.push(problemTag);
    }

    query += ' ORDER BY vote_count DESC, p.name ASC';

    const stmt = c.env.DB.prepare(query);
    const result = await stmt.bind(...params).all();

    return c.json({ success: true, results: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============ 리더 선정 API ============

// 리더 자동 선정 (문제 태그별 상위 N명)
app.post('/api/events/:eventId/leaders/select', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    // 모든 문제 태그 가져오기
    const tagsResult = await c.env.DB.prepare(
      'SELECT DISTINCT problem_tag FROM participants WHERE event_id = ? AND problem_tag IS NOT NULL AND problem_tag != ""'
    ).bind(eventId).all();

    let totalLeaders = 0;

    for (const tag of tagsResult.results as { problem_tag: string }[]) {
      // 해당 태그의 참가자 수
      const countResult = await c.env.DB.prepare(
        'SELECT COUNT(*) as count FROM participants WHERE event_id = ? AND problem_tag = ?'
      ).bind(eventId, tag.problem_tag).first() as { count: number };

      // 리더 수 = 참가자 수 / 4 (반올림)
      const leaderCount = Math.round(countResult.count / 4);

      if (leaderCount > 0) {
        // 득표 상위 N명을 리더로 선정
        const topCandidates = await c.env.DB.prepare(`
          SELECT id FROM participants
          WHERE event_id = ? AND problem_tag = ?
          ORDER BY vote_count DESC, name ASC
          LIMIT ?
        `).bind(eventId, tag.problem_tag, leaderCount).all();

        for (const candidate of topCandidates.results as { id: number }[]) {
          await c.env.DB.prepare(
            'UPDATE participants SET is_leader = 1 WHERE id = ?'
          ).bind(candidate.id).run();

          // 팀 생성
          await c.env.DB.prepare(
            'INSERT INTO teams (event_id, leader_id, problem_tag, status) VALUES (?, ?, ?, "forming")'
          ).bind(eventId, candidate.id, tag.problem_tag).run();

          // 리더를 팀 멤버로 추가
          const teamResult = await c.env.DB.prepare(
            'SELECT id FROM teams WHERE leader_id = ? AND event_id = ?'
          ).bind(candidate.id, eventId).first() as { id: number };

          await c.env.DB.prepare(
            'INSERT INTO team_members (team_id, participant_id, role) VALUES (?, ?, "leader")'
          ).bind(teamResult.id, candidate.id).run();

          totalLeaders++;
        }
      }
    }

    // 이벤트 단계 변경
    await c.env.DB.prepare('UPDATE events SET phase = "team_forming" WHERE id = ?').bind(eventId).run();

    return c.json({ success: true, message: `${totalLeaders}명의 리더가 선정되었습니다.`, leader_count: totalLeaders });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 리더 목록 조회
app.get('/api/events/:eventId/leaders', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM participants WHERE event_id = ? AND is_leader = 1 ORDER BY problem_tag, name'
    ).bind(eventId).all();

    return c.json({ success: true, leaders: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ============ 팀 API ============

// 팀 목록 조회
app.get('/api/events/:eventId/teams', async (c) => {
  const eventId = c.req.param('eventId');

  try {
    const teams = await c.env.DB.prepare(`
      SELECT t.*, p.name as leader_name, p.company as leader_company,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
      FROM teams t
      JOIN participants p ON t.leader_id = p.id
      WHERE t.event_id = ?
      ORDER BY t.problem_tag, p.name
    `).bind(eventId).all();

    return c.json({ success: true, teams: teams.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 팀 상세 조회 (멤버 포함)
app.get('/api/events/:eventId/teams/:teamId', async (c) => {
  const eventId = c.req.param('eventId');
  const teamId = c.req.param('teamId');

  try {
    const team = await c.env.DB.prepare(`
      SELECT t.*, p.name as leader_name, p.company as leader_company
      FROM teams t
      JOIN participants p ON t.leader_id = p.id
      WHERE t.id = ? AND t.event_id = ?
    `).bind(teamId, eventId).first();

    if (!team) {
      return c.json({ success: false, error: '팀을 찾을 수 없습니다.' }, 404);
    }

    const members = await c.env.DB.prepare(`
      SELECT p.*, tm.role
      FROM team_members tm
      JOIN participants p ON tm.participant_id = p.id
      WHERE tm.team_id = ?
      ORDER BY tm.role DESC, p.name
    `).bind(teamId).all();

    return c.json({ success: true, team, members: members.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 팀원 추가 (리더가 선택)
app.post('/api/events/:eventId/teams/:teamId/members', async (c) => {
  const eventId = c.req.param('eventId');
  const teamId = c.req.param('teamId');

  try {
    const body = await c.req.json();
    const { participant_id } = body;

    // 팀 확인
    const team = await c.env.DB.prepare(
      'SELECT * FROM teams WHERE id = ? AND event_id = ?'
    ).bind(teamId, eventId).first() as { id: number; problem_tag: string; status: string } | null;

    if (!team) {
      return c.json({ success: false, error: '팀을 찾을 수 없습니다.' }, 404);
    }

    if (team.status === 'confirmed') {
      return c.json({ success: false, error: '이미 확정된 팀입니다.' }, 400);
    }

    // 현재 멤버 수 확인 (최대 4명)
    const memberCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?'
    ).bind(teamId).first() as { count: number };

    if (memberCount.count >= 4) {
      return c.json({ success: false, error: '팀은 최대 4명까지만 가능합니다.' }, 400);
    }

    // 참가자 확인 (같은 문제 태그인지)
    const participant = await c.env.DB.prepare(
      'SELECT * FROM participants WHERE id = ? AND event_id = ?'
    ).bind(participant_id, eventId).first() as { id: number; problem_tag: string; is_leader: number } | null;

    if (!participant) {
      return c.json({ success: false, error: '참가자를 찾을 수 없습니다.' }, 404);
    }

    if (participant.problem_tag !== team.problem_tag) {
      return c.json({ success: false, error: '같은 문제 태그의 참가자만 팀에 추가할 수 있습니다.' }, 400);
    }

    // 이미 다른 팀에 속해 있는지 확인
    const existingMember = await c.env.DB.prepare(
      'SELECT tm.* FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE tm.participant_id = ? AND t.event_id = ?'
    ).bind(participant_id, eventId).first();

    if (existingMember) {
      return c.json({ success: false, error: '이미 다른 팀에 속해 있습니다.' }, 400);
    }

    // 팀원 추가
    await c.env.DB.prepare(
      'INSERT INTO team_members (team_id, participant_id, role) VALUES (?, ?, "member")'
    ).bind(teamId, participant_id).run();

    return c.json({ success: true, message: '팀원이 추가되었습니다.' });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 팀원 제거
app.delete('/api/events/:eventId/teams/:teamId/members/:participantId', async (c) => {
  const teamId = c.req.param('teamId');
  const participantId = c.req.param('participantId');

  try {
    // 리더는 제거 불가
    const member = await c.env.DB.prepare(
      'SELECT role FROM team_members WHERE team_id = ? AND participant_id = ?'
    ).bind(teamId, participantId).first() as { role: string } | null;

    if (!member) {
      return c.json({ success: false, error: '팀원을 찾을 수 없습니다.' }, 404);
    }

    if (member.role === 'leader') {
      return c.json({ success: false, error: '리더는 제거할 수 없습니다.' }, 400);
    }

    await c.env.DB.prepare(
      'DELETE FROM team_members WHERE team_id = ? AND participant_id = ?'
    ).bind(teamId, participantId).run();

    return c.json({ success: true, message: '팀원이 제거되었습니다.' });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 팀 확정
app.patch('/api/events/:eventId/teams/:teamId/confirm', async (c) => {
  const teamId = c.req.param('teamId');

  try {
    // 멤버 수 확인 (4명이어야 함)
    const memberCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?'
    ).bind(teamId).first() as { count: number };

    if (memberCount.count !== 4) {
      return c.json({ success: false, error: '팀은 4명이어야 확정할 수 있습니다.' }, 400);
    }

    await c.env.DB.prepare(
      'UPDATE teams SET status = "confirmed" WHERE id = ?'
    ).bind(teamId).run();

    return c.json({ success: true, message: '팀이 확정되었습니다.' });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// 배정되지 않은 참가자 목록
app.get('/api/events/:eventId/unassigned', async (c) => {
  const eventId = c.req.param('eventId');
  const problemTag = c.req.query('problem_tag');

  try {
    let query = `
      SELECT p.* FROM participants p
      WHERE p.event_id = ?
      AND p.id NOT IN (
        SELECT tm.participant_id FROM team_members tm
        JOIN teams t ON tm.team_id = t.id
        WHERE t.event_id = ?
      )
    `;
    const params: any[] = [eventId, eventId];

    if (problemTag) {
      query += ' AND p.problem_tag = ?';
      params.push(problemTag);
    }

    query += ' ORDER BY p.vote_count DESC, p.name';

    const stmt = c.env.DB.prepare(query);
    const result = await stmt.bind(...params).all();

    return c.json({ success: true, participants: result.results });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Cloudflare Pages Functions export
interface PagesContext<E = any> {
  request: Request;
  env: E;
  next: () => Promise<Response>;
}

export const onRequest = async (context: PagesContext<Env>): Promise<Response> => {
  const url = new URL(context.request.url);

  // API 경로만 Hono로 처리
  if (url.pathname.startsWith('/api/')) {
    return app.fetch(context.request, context.env as Env);
  }

  // 나머지는 정적 파일 서빙 (Pages가 처리)
  return context.next();
};
