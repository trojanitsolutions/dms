import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  // The same path as `frontendRoute` in vite.config.ts
  history: createWebHistory('/dms'),
  routes: [
    { path: '/', redirect: '/employee-checkin' },
    {
      path: '/employee-checkin',
      component: () => import('./pages/EmployeeCheckinReport.vue'),
    },
    {
      path: '/sales-availability',
      component: () => import('./pages/SalesAvailabilityReport.vue'),
    },
    { path: '/:path(.*)*', component: () => import('./pages/NotFound.vue') },
  ],
})
