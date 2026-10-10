const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const encoder = new TextEncoder();

const json = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8'
    }
  }
);

function basicAuth(username: string, password: string) {
  const bytes = encoder.encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return `Basic ${btoa(binary)}`;
}

async function webdavRequest(method: string, path: string, init: RequestInit = {}) {
  const baseUrl = Deno.env.get('WEBDAV_BASE_URL');
  const username = Deno.env.get('WEBDAV_USERNAME');
  const password = Deno.env.get('WEBDAV_PASSWORD');

  if (!baseUrl || !username || !password) {
    throw new Error('WebDAV 服务端配置不完整。');
  }

  return fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    method,
    headers: {
      authorization: basicAuth(username, password),
      ...(init.headers || {})
    }
  });
}

function trainingFileName() {
  return `gomoku-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomUUID()}.json`;
}

async function uploadGomokuTrainingData(payload: any) {
  if (!payload || !['win', 'loss', 'draw'].includes(payload.result)) {
    throw new Error('对局结果不合法。');
  }

  if (![1, 2, 3, 6, 7, 8, 9, 9.1, 9.2].includes(payload.modelVersion)) {
    throw new Error('模型版本不合法。');
  }

  const modelBattle = payload.modelBattle === true;
  if (payload.modelBattle !== undefined && typeof payload.modelBattle !== 'boolean') {
    throw new Error('模型对战标记不合法。');
  }

  const acceptsResult = [8, 9, 9.1, 9.2].includes(payload.modelVersion);
  if (!acceptsResult) {
    throw new Error('该模型版本不接收此类训练数据。');
  }

  if (
    !Array.isArray(payload.moves) ||
    payload.moves.length < 1 ||
    payload.moves.length > 225
  ) {
    throw new Error('对局落子数据不合法。');
  }

  if (
    ![1, 2].includes(payload.playerColor) ||
    ![1, 2].includes(payload.aiColor) ||
    payload.playerColor === payload.aiColor
  ) {
    throw new Error('对局执子信息不合法。');
  }

  if (modelBattle) {
    if (![1, 2, 3, 6, 7, 8, 9, 9.1, 9.2].includes(payload.opponentModelVersion)) {
      throw new Error('对手模型版本不合法。');
    }
  } else if (payload.opponentModelVersion !== null && payload.opponentModelVersion !== undefined) {
    throw new Error('普通对局不能填写对手模型版本。');
  }

  const occupied = new Set<string>();
  const firstPlayer = payload.moves[0]?.player;

  const moves = payload.moves.map((move: any, index: number) => {
    if (
      !Number.isInteger(move?.row) ||
      !Number.isInteger(move?.col) ||
      ![1, 2].includes(move.player)
    ) {
      throw new Error('对局落子数据不合法。');
    }

    if (
      move.row < 0 ||
      move.row >= 15 ||
      move.col < 0 ||
      move.col >= 15
    ) {
      throw new Error('对局坐标超出棋盘范围。');
    }

    if (move.player !== (index % 2 === 0 ? firstPlayer : 3 - firstPlayer)) {
      throw new Error('对局落子顺序不合法。');
    }

    const coordinate = `${move.row},${move.col}`;
    if (occupied.has(coordinate)) {
      throw new Error('对局落子位置重复。');
    }

    occupied.add(coordinate);
    return {
      move: index + 1,
      row: move.row,
      col: move.col,
      player: move.player
    };
  });

  const body = JSON.stringify({
    schema: 'algorithm-club.gomoku-training.v1',
    result: payload.result,
    model_version: payload.modelVersion,
    nickname: typeof payload.nickname === 'string'
      ? payload.nickname.slice(0, 40)
      : null,
    player_color: payload.playerColor,
    ai_color: payload.aiColor,
    model_battle: modelBattle,
    model_color: payload.aiColor,
    opponent_model_color: modelBattle ? 3 - payload.aiColor : null,
    opponent_model_version: modelBattle ? payload.opponentModelVersion : null,
    moves,
    move_count: moves.length,
    created_at: new Date().toISOString()
  });

  const trainingDirectory = '/gomokudata/';
  const directoryResponse = await webdavRequest('MKCOL', trainingDirectory);
  if (!directoryResponse.ok && directoryResponse.status !== 405) {
    throw new Error(`训练数据目录创建失败（${directoryResponse.status}）。`);
  }

  const fileName = trainingFileName();
  const response = await webdavRequest(
    'PUT',
    `${trainingDirectory}${encodeURIComponent(fileName)}`,
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(encoder.encode(body).byteLength)
      },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`训练数据上传失败（${response.status}）。`);
  }

  return {
    ok: true,
    fileName,
    bytes: encoder.encode(body).byteLength
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: '只支持 POST 请求。' }, 405);
  }

  try {
    const payload = await request.json().catch(() => ({}));
    return json({ upload: await uploadGomokuTrainingData(payload) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '训练数据上传失败。';
    return json({ error: message }, 400);
  }
});
