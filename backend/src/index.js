// 简尚系统后端入口文件
// 用途：启动服务器，处理请求

import fastify from 'fastify'

// 创建 Fastify 实例
const server = fastify({
  logger: true  // 开启日志
})

// 健康检查接口
// 用途：验证服务器是否正常
server.get('/health', async () => {
  return {
    status: 'ok',
    message: '简尚系统运行中',
    time: new Date().toISOString()
  }
})

// 首页接口
server.get('/', async () => {
  return {
    name: '简尚系统',
    version: '1.0.0',
    message: '欢迎使用简尚系统 API'
  }
})

// 启动服务器
const start = async () => {
  try {
    // 监听 3000 端口，允许外部访问
    await server.listen({ port: 3000, host: '0.0.0.0' })
    console.log('🚀 简尚系统后端启动成功！')
    console.log('📍 地址：http://localhost:3000')
    console.log('🏥 健康检查：http://localhost:3000/health')
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

start()
