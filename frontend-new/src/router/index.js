import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import ProfilePage from '../views/ProfilePage.vue'
import MainLayout from '../layouts/MainLayout.vue'
import Dashboard from '../views/Dashboard.vue'
import AccountList from '../views/accounts/AccountList.vue'
import TransactionList from '../views/transactions/TransactionList.vue'
import ProductList from '../views/products/ProductList.vue'
import EmployeeList from '../views/employees/EmployeeList.vue'
import RolePermissions from '../views/system/RolePermissions.vue'
import SystemSettings from '../views/system/SystemSettings.vue'
import ChatIndex from '../views/chat/ChatIndex.vue'
import EmployeeDashboard from '../views/EmployeeDashboard.vue'
import ProjectWorkOrderHome from '../views/projects/ProjectWorkOrderHome.vue'
import ProjectList from '../views/projects/ProjectList.vue'
import ProjectDetail from '../views/projects/ProjectDetail.vue'
import ProjectSupplyList from '../views/projects/ProjectSupplyList.vue'
import FinanceOverview from '../views/finance/FinanceOverview.vue'
import FileCenter from '../views/files/FileCenter.vue'
import { getAuthToken, clearAuthSession } from '../utils/authSession'

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
      { path: 'dashboard', name: 'Dashboard', component: Dashboard, meta: { title: '控制台' } },
      { path: 'accounts', name: 'Accounts', component: AccountList, meta: { title: '账户管理' } },
      { path: 'transactions', name: 'Transactions', component: TransactionList, meta: { title: '交易流水' } },
      { path: 'products', name: 'Products', component: ProductList, meta: { title: '产品库存' } },
      { path: 'employees', name: 'Employees', component: EmployeeList, meta: { title: '员工管理' } },
      { path: 'roles', name: 'Roles', component: RolePermissions, meta: { title: '角色权限' } },
      { path: 'system/settings', name: 'SystemSettings', component: SystemSettings, meta: { title: '系统设置' } },
      // 旧路由重定向到系统设置
      { path: 'users', redirect: '/main/system/settings' },
      { path: 'system/ai-permissions', redirect: '/main/system/settings' },
      { path: 'employee-dashboard', name: 'EmployeeDashboard', component: EmployeeDashboard, meta: { title: '工作台' } },
      { path: 'profile', name: 'Profile', component: ProfilePage, meta: { title: '个人设置' } },
      { path: 'chat', name: 'Chat', component: ChatIndex, meta: { title: '聊天' } },
      { path: 'files', name: 'FileCenter', component: FileCenter, meta: { title: '文件中心' } },
      { path: 'projects', name: 'ProjectWorkOrderHome', component: ProjectWorkOrderHome, meta: { title: '项目工单' } },
      { path: 'projects/construction', name: 'Projects', component: ProjectList, meta: { title: '施工项目工单' } },
      { path: 'projects/supply', name: 'ProjectSupplyList', component: ProjectSupplyList, meta: { title: '项目供货单' } },
      { path: 'projects/:id', name: 'ProjectDetail', component: ProjectDetail, meta: { title: '工单详情' } },
      { path: 'finance/overview', name: 'FinanceOverview', component: FinanceOverview, meta: { title: '财务总览' } }
    ]
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
      const payload = JSON.parse(atob(token.split('.')[1]))
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
