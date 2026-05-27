'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { OrderWizard } from '@/components/order-flow'
import { Button, Card } from '@/components/ui'

interface AgentBrief {
  id: string
  fullName: string | null
  email: string
  company: string | null
}

interface TeamMember {
  id: string
  name: string
  email: string | null
  phone: string | null
  hasLogin: boolean
  userId: string | null
}

type Inventory = {
  signs: Array<{ id: string; description: string; size: string | null }>
  riders: Array<{ id: string; rider_type: string; quantity: number }>
  lockboxes: Array<{ id: string; lockbox_type: string; lockbox_type_name?: string; lockbox_code: string | null }>
  brochureBoxes: { quantity: number } | null
}

// Outer default export wraps the inner client component in <Suspense> —
// required by Next.js 14 App Router when any descendant uses useSearchParams,
// or the production build fails at static prerender time.
export default function PlaceOrderPage() {
  return (
    <Suspense
      fallback={
        <div>
          <Header title="Place New Order" />
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      }
    >
      <PlaceOrderPageInner />
    </Suspense>
  )
}

function PlaceOrderPageInner() {
  const searchParams = useSearchParams()
  const onBehalfOf = searchParams.get('on_behalf_of') || undefined

  const [inventory, setInventory] = useState<Inventory | undefined>()

  const [paymentMethods, setPaymentMethods] = useState<Array<{
    id: string
    card_brand: string | null
    card_last4: string | null
    is_default: boolean
  }> | undefined>()

  const [agent, setAgent] = useState<AgentBrief | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)

  // team_admin (no on_behalf_of) only: the team's roster, the picked member,
  // and that member's loaded inventory. When `selectedMember` is null we show
  // the "Who is this order for?" gate instead of the wizard.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [hasTeam, setHasTeam] = useState(false)
  // Per-broker perk: owned-lockbox install is free for this team.
  const [freeLockboxInstall, setFreeLockboxInstall] = useState(false)
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [memberInventory, setMemberInventory] = useState<Inventory | undefined>()
  const [memberInventoryLoading, setMemberInventoryLoading] = useState(false)

  // Whether we should render the team_admin member-selection gate rather than
  // the standard (own/inventory or on_behalf_of) flow. Only when a team_admin
  // is placing an order without an explicit ?on_behalf_of target.
  const isTeamAdminGate = currentUserRole === 'team_admin' && !onBehalfOf

  useEffect(() => {
    async function fetchData() {
      try {
        const inventoryUrl = onBehalfOf
          ? `/api/inventory?on_behalf_of=${encodeURIComponent(onBehalfOf)}`
          : '/api/inventory'

        const requests: Promise<Response>[] = [
          fetch(inventoryUrl),
          fetch('/api/payments/methods'),
          fetch('/api/profile'),
        ]
        // If placing on behalf, fetch the agent's name for the banner
        if (onBehalfOf) {
          requests.push(fetch(`/api/admin/customers/${onBehalfOf}`))
        }
        const [inventoryRes, paymentsRes, profileRes, agentRes] = await Promise.all(requests)

        if (inventoryRes.ok) {
          const data = await inventoryRes.json()
          setInventory(data)
        } else if (inventoryRes.status === 403) {
          setAccessError('You do not have permission to place orders for this agent.')
        }

        if (paymentsRes.ok) {
          const data = await paymentsRes.json()
          setPaymentMethods(data.paymentMethods)
        }

        let role: string | null = null
        if (profileRes?.ok) {
          const data = await profileRes.json()
          role = data.user?.role || null
          setCurrentUserRole(role)
        }

        if (agentRes && agentRes.ok) {
          const data = await agentRes.json()
          setAgent({
            id: data.customer.id,
            fullName: data.customer.full_name,
            email: data.customer.email,
            company: data.customer.company_name,
          })
        }

        // team_admin without an explicit on_behalf_of target picks an agent
        // from their team roster before the wizard. Load that roster now.
        if (role === 'team_admin' && !onBehalfOf) {
          const teamsRes = await fetch('/api/teams')
          if (teamsRes.ok) {
            const teamsData = await teamsRes.json()
            setHasTeam(!!teamsData.team)
            setFreeLockboxInstall(!!teamsData.team?.freeLockboxInstall)
            setTeamMembers(Array.isArray(teamsData.members) ? teamsData.members : [])
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [onBehalfOf])

  // Load the selected team member's filtered inventory, then drop into the wizard.
  async function handleSelectMember(member: TeamMember) {
    setSelectedMember(member)
    setMemberInventory(undefined)
    setMemberInventoryLoading(true)
    try {
      const res = await fetch(`/api/inventory?member_id=${encodeURIComponent(member.id)}`)
      if (res.ok) {
        const data = await res.json()
        setMemberInventory(data)
      }
    } catch (error) {
      console.error('Error loading member inventory:', error)
    } finally {
      setMemberInventoryLoading(false)
    }
  }

  function handleChangeAgent() {
    setSelectedMember(null)
    setMemberInventory(undefined)
    setMemberInventoryLoading(false)
  }

  const headerTitle = agent
    ? `Place Order for ${agent.fullName || agent.email}`
    : isTeamAdminGate && selectedMember
      ? `Place Order for ${selectedMember.name}`
      : 'Place New Order'

  return (
    <div>
      <Header title={headerTitle} />

      <div className="p-6">
        {accessError ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-800">
            {accessError}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isTeamAdminGate ? (
          // team_admin (no on_behalf_of): pick an agent, then run the wizard
          // against that member's inventory.
          selectedMember ? (
            <>
              <div className="mb-6 p-4 bg-pink-50 border border-pink-200 rounded-xl flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-pink-700 uppercase tracking-wide">Placing order for</p>
                  <p className="font-semibold text-gray-900">
                    {selectedMember.name}
                    {selectedMember.email && (
                      <span className="text-gray-500 font-normal"> · {selectedMember.email}</span>
                    )}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleChangeAgent}>
                  Change agent
                </Button>
              </div>
              {memberInventoryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <OrderWizard
                  inventory={memberInventory}
                  paymentMethods={paymentMethods}
                  currentUserRole={currentUserRole}
                  // Preset the agent name; the wizard merges this over its
                  // full defaults.
                  initialFormData={{ placed_for_agent_name: selectedMember.name }}
                  lockboxInstallFee={freeLockboxInstall ? 0 : undefined}
                />
              )}
            </>
          ) : (
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Who is this order for?</h2>
              <p className="text-sm text-gray-600 mt-1 mb-5">
                Select the agent on your team this order is being placed for.
              </p>
              {teamMembers.length === 0 ? (
                <Card variant="bordered" className="p-6 text-center">
                  <p className="text-gray-900 font-medium">
                    {hasTeam ? 'Your team has no members yet.' : 'You have not set up a team yet.'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1 mb-4">
                    Add a team member to place an order for them.
                  </p>
                  <Link href="/dashboard/teams">
                    <Button variant="primary" size="md">Go to Team Management</Button>
                  </Link>
                </Card>
              ) : (
                <div className="space-y-3">
                  {teamMembers.map((member) => (
                    <Card
                      key={member.id}
                      variant="interactive"
                      className="p-4 border border-gray-200 flex items-center justify-between gap-4"
                      onClick={() => handleSelectMember(member)}
                    >
                      <div>
                        <p className="font-semibold text-gray-900">{member.name}</p>
                        {member.email && <p className="text-sm text-gray-500">{member.email}</p>}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectMember(member)
                        }}
                      >
                        Select
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          // Regular customers AND the existing ?on_behalf_of admin flow — unchanged.
          <>
            {agent && (
              <div className="mb-6 p-4 bg-pink-50 border border-pink-200 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-pink-700 uppercase tracking-wide">Placing on behalf of</p>
                  <p className="font-semibold text-gray-900">
                    {agent.fullName || agent.email}
                    {agent.company && <span className="text-gray-500 font-normal"> · {agent.company}</span>}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Their inventory is loaded. Your card on file will be charged at checkout.
                  </p>
                </div>
              </div>
            )}
            <OrderWizard
              inventory={inventory}
              paymentMethods={paymentMethods}
              onBehalfOf={onBehalfOf}
              currentUserRole={currentUserRole}
            />
          </>
        )}
      </div>
    </div>
  )
}
