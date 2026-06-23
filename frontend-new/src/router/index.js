import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import ProfilePage from '../views/ProfilePage.vue'
import MainLayout from '../layouts/MainLayout.vue'
import { getAuthToken, clearAuthSession, getTokenPayload } from '../utils/authSession'

const routes = [
  {
    path: '/',
    name: 'Login',
    component: Login
  },
  {
    path: '/main',
    component: MainLayout,
    redirect: '/main/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import("../views/Dashboard.vue"), meta: { title: '控制台' } },
      { path: 'accounts', name: 'Accounts', component: () => import("../views/accounts/AccountList.vue"), meta: { title: '账户管理' } },
      { path: 'transactions', name: 'Transactions', component: () => import("../views/transactions/TransactionList.vue"), meta: { title: '交易流水' } },
      { path: 'products', name: 'Products', component: () => import("../views/products/ProductList.vue"), meta: { title: '产品库存' } },
      { path: 'employees', name: 'Employees', component: () => import("../views/employees/EmployeeList.vue"), meta: { title: '员工管理' } },
      { path: 'roles', name: 'Roles', component: () => import("../views/system/RolePermissions.vue"), meta: { title: '角色权限' } },
      { path: 'system/settings', name: 'SystemSettings', component: () => import("../views/system/SystemSettings.vue"), meta: { title: '系统设置' } },
      // 旧路由重定向到系统设置
      { path: 'users', redirect: '/main/system/settings' },
      { path: 'system/ai-permissions', redirect: '/main/system/settings' },
      { path: 'employee-dashboard', name: 'EmployeeDashboard', component: () => import("../views/EmployeeDashboard.vue"), meta: { title: '工作台' } },
      { path: 'profile', name: 'Profile', component: ProfilePage, meta: { title: '个人设置' } },
      { path: 'chat', name: 'Chat', component: () => import("../views/chat/ChatIndex.vue"), meta: { title: '聊天' } },
      { path: 'files', name: 'FileCenter', component: () => import("../views/files/FileCenter.vue"), meta: { title: '文件中心' } },
      { path: 'projects', name: 'ProjectWorkOrderHome', component: () => import("../views/projects/ProjectWorkOrderHome.vue"), meta: { title: '项目工单' } },
      { path: 'projects/construction', name: 'Projects', component: () => import("../views/projects/ProjectList.vue"), meta: { title: '施工项目工单' } },
      { path: 'projects/supply', name: 'ProjectSupplyList', component: () => import("../views/projects/ProjectSupplyList.vue"), meta: { title: '项目供货单' } },
      { path: 'projects/:id', name: 'ProjectDetail', component: () => import("../views/projects/ProjectDetail.vue"), meta: { title: '工单详情' } },
      { path: 'finance/overview', name: 'FinanceOverview', component: () => import("../views/finance/FinanceOverview.vue"), meta: { title: '财务总览' } },
      { path: 'finance/ledger', name: 'FinanceLedger', component: () => import("../views/finance/FinanceLedger.vue"), meta: { title: '入账登记表' } }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: () => (getAuthToken() ? '/main/dashboard' : '/')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫：未登录跳转登录页，过期 token 自动清理
router.beforeEach((to, from) => {
  const token = getAuthToken()
  if (to.name !== 'Login' && !token) {
    return '/'
  }
  if (token) {
    try {
      const payload = getTokenPayload(token)
      if (!payload) throw new Error('Invalid token')
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        clearAuthSession({ clearRemembered: true })
        if (to.name !== 'Login') {
          return '/'
        }
      }
      if (to.path === '/main/dashboard' && !['super_admin', 'admin'].includes(payload.role)) {
        return '/main/employee-dashboard'
      }
    } catch {
      // token 格式损坏，清除并跳转登录
      clearAuthSession({ clearRemembered: true })
      if (to.name !== 'Login') {
        return '/'
      }
    }
  }
})

export default router
