// 知识库搜索接口 - 代理到 Python 搜索服务器
const SEARCH_SERVER = 'http://127.0.0.1:18790'

export default function kbRoutes(server, db) {
  // 知识库搜索
  server.post('/api/knowledge-base/search', async (request, reply) => {
    const { query, top_k = 5, threshold = 0.25 } = request.body || {}
    if (!query) {
      return reply.code(400).send({ success: false, message: '查询内容不能为空' })
    }

    try {
      const res = await fetch(`${SEARCH_SERVER}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k, threshold }),
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        const err = await res.text()
        return reply.code(502).send({ success: false, message: `搜索服务异常: ${err}` })
      }

      const data = await res.json()
      return { success: true, data }
    } catch (err) {
      return reply.code(503).send({
        success: false,
        message: '知识库服务未启动，请执行: python3 ~/.openclaw/workspace/scripts/search-server.py &',
      })
    }
  })

  // 健康检查
  server.get('/api/knowledge-base/health', async () => {
    try {
      const res = await fetch(`${SEARCH_SERVER}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await res.json()
      return { success: true, data }
    } catch {
      return { success: false, message: '搜索服务未运行' }
    }
  })
}
