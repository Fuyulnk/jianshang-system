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
import ProjectList from '../views/projects/ProjectList.vue'
import ProjectDetail from '../views/projects/ProjectDetail.vue'
import FinanceOverview from '../views/finance/FinanceOverview.vue'
import FileCenter from '../views/files/FileCenter.vue'

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
      { path: 'projects', name: 'Projects', component: ProjectList, meta: { title: '项目工单' } },
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
  const token = localStorage.getItem('token')
  if (to.name !== 'Login' && !token) {
    return '/'
  }
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        if (to.name !== 'Login') {
          return '/'
        }
      }
    } catch {
      // token 格式损坏，清除并跳转登录
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (to.name !== 'Login') {
        return '/'
      }
    }
  }
})

export default router
