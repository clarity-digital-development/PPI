import { Sidebar } from '@/components/dashboard'
import PolicyNoticeGate from '@/components/dashboard/PolicyNoticeGate'
import ContactInfoGate from '@/components/dashboard/ContactInfoGate'
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
  // Accounts missing a name or phone (mostly ones that came over from the
  // October 2026 move) are asked for them, after the policy notice, never on
  // top of it.
  const needsContact =
    !!user && user.role !== 'admin' && (!user.fullName?.trim() || !user.phone?.trim())

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="lg:pl-64">
        {children}
      </main>
      {showNotice ? (
        <PolicyNoticeGate notice={CURRENT_NOTICE} />
      ) : (
        needsContact && user && <ContactInfoGate fullName={user.fullName ?? ''} phone={user.phone ?? ''} />
      )}
    </div>
  )
}
