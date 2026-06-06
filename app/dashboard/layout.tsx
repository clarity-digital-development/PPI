import { Sidebar } from '@/components/dashboard'
import PolicyNoticeGate from '@/components/dashboard/PolicyNoticeGate'
import { getCurrentUser } from '@/lib/auth-utils'
import { CURRENT_NOTICE, shouldShowPolicyNotice } from '@/lib/policy-notices'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // WHY: decide gate visibility server-side to avoid a flash for exempt users
  const user = await getCurrentUser()
  const showNotice = user ? shouldShowPolicyNotice(user) : false

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="lg:pl-64">
        {children}
      </main>
      {showNotice && <PolicyNoticeGate notice={CURRENT_NOTICE} />}
    </div>
  )
}
