import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin, canActOnBehalfOf } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

const ALLOWED_ROLES = ['customer', 'admin', 'team_admin'] as const
type AllowedRole = (typeof ALLOWED_ROLES)[number]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdminOrTeamAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Team admins can only view customers in their own team
    if (!(await canActOnBehalfOf(user, id))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get customer profile
    const customer = await prisma.user.findUnique({
      where: { id },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Get all inventory and related data
    const [signsAll, ridersAll, lockboxesAll, brochureBoxesAll, otherItemsRaw, ordersRaw, installationsRaw] =
      await Promise.all([
        prisma.customerSign.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customerRider.findMany({
          where: { userId: id },
          include: { rider: true },
          // Stable desc-by-createdAt ordering — matches signs/otherItems and
          // lets the admin UI's bundle decrement consistently pop the oldest
          // record without depending on Postgres heap-scan luck.
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customerLockbox.findMany({
          where: { userId: id },
          include: { lockboxType: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customerBrochureBox.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customerOtherItem.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.findMany({
          where: { userId: id },
          include: { orderItems: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.installation.findMany({
          where: { userId: id },
          include: {
            riders: { include: { rider: true } },
            lockboxes: { include: { lockboxType: true } },
          },
          orderBy: { installedAt: 'desc' },
        }),
      ])

    // Split items by inStorage status — only in-storage items appear in main inventory,
    // out-of-storage items appear in a separate "deployed" section so admin can return them
    const signsRaw = signsAll.filter(s => s.inStorage)
    const signsOutOfStorage = signsAll.filter(s => !s.inStorage)
    const ridersRaw = ridersAll.filter(r => r.inStorage)
    const ridersOutOfStorage = ridersAll.filter(r => !r.inStorage)
    const lockboxesRaw = lockboxesAll.filter(lb => lb.inStorage)
    const lockboxesOutOfStorage = lockboxesAll.filter(lb => !lb.inStorage)
    const brochureBoxesRaw = brochureBoxesAll.filter(b => b.inStorage)
    const brochureBoxesOutOfStorage = brochureBoxesAll.filter(b => !b.inStorage)

    // Transform data to match frontend expectations
    // Aggregate signs by description with quantity counts
    const signMap: Record<string, { id: string; description: string; size: null; quantity: number }> = {}
    for (const sign of signsRaw) {
      if (signMap[sign.description]) {
        signMap[sign.description].quantity += 1
      } else {
        signMap[sign.description] = { id: sign.id, description: sign.description, size: null, quantity: 1 }
      }
    }
    const signs = Object.values(signMap)

    // Aggregate riders by type with quantity counts
    const riderMap: Record<string, { id: string; rider_id: string; rider_type: string; quantity: number }> = {}
    for (const r of ridersRaw) {
      const key = r.riderId
      if (riderMap[key]) {
        riderMap[key].quantity += 1
      } else {
        riderMap[key] = {
          id: r.id,
          rider_id: r.riderId,
          rider_type: r.rider.name,
          quantity: 1,
        }
      }
    }
    const riders = Object.values(riderMap)

    // Return each lockbox individually (each has a different code)
    const lockboxes = lockboxesRaw.map((lb) => ({
      id: lb.id,
      lockbox_type_id: lb.lockboxTypeId,
      lockbox_type: lb.lockboxType.name,
      lockbox_code: lb.code,
    }))

    // Aggregate brochure boxes into a single count
    const brochureBoxes = brochureBoxesRaw.length > 0
      ? { id: brochureBoxesRaw[0].id, quantity: brochureBoxesRaw.length }
      : null

    // Build deployed list — flat per-item so admin can mark each one back to storage.
    // assignedToMemberId is preserved through the inStorage:true→false flip (only
    // inStorage/heldByHoldId/heldUntil mutate on deployment), so the agent who
    // originally owned the inventory survives. The UI uses it to render an agent
    // pill so two "For Sale Sign" rows from different agents are distinguishable.
    const deployed = {
      signs: signsOutOfStorage.map(s => ({ id: s.id, description: s.description, assignedToMemberId: s.assignedToMemberId ?? null })),
      riders: ridersOutOfStorage.map(r => ({ id: r.id, rider_type: r.rider.name, assignedToMemberId: r.assignedToMemberId ?? null })),
      lockboxes: lockboxesOutOfStorage.map(lb => ({ id: lb.id, lockbox_type: lb.lockboxType.name, lockbox_code: lb.code, assignedToMemberId: lb.assignedToMemberId ?? null })),
      brochureBoxes: brochureBoxesOutOfStorage.map(b => ({ id: b.id, description: b.description, assignedToMemberId: b.assignedToMemberId ?? null })),
    }

    // Transform orders to match frontend expectations
    const orders = ordersRaw.map((order) => ({
      id: order.id,
      order_number: order.orderNumber,
      status: order.status,
      total: Number(order.total),
      created_at: order.createdAt.toISOString(),
    }))

    // Transform installations
    const installations = installationsRaw.map((inst) => ({
      id: inst.id,
      address: inst.propertyAddress,
      city: inst.propertyCity,
      post_type: 'Standard',
      status: inst.status,
      installation_date: inst.installedAt.toISOString(),
    }))

    // Include the team roster for any team-member customer (admin OR agent)
    // so the per-agent inventory grouping works regardless of role.
    // `members` is the ACTIVE roster (drives assign dropdowns); `memberNames`
    // covers ALL members past and present, so historical assignments to
    // soft-removed agents still resolve to a human name on the Currently
    // Deployed pill rather than rendering as "Unknown agent" (the case
    // where admins MOST need the name — to call them and recover the sign).
    let team: {
      id: string
      name: string
      // Per-team pricing perks, editable from the customer page.
      pickup_fee_waived: boolean
      free_lockbox_install: boolean
      members: Array<{ id: string; name: string; email: string | null; phone: string | null; hasLogin: boolean }>
      memberNames: Array<{ id: string; name: string }>
    } | null = null
    if (customer.teamId) {
      const t = await prisma.team.findUnique({
        where: { id: customer.teamId },
        include: { teamMembers: { orderBy: { createdAt: 'asc' } } },
      })
      if (t) {
        const activeMembers = t.teamMembers.filter((m) => m.removedAt === null)
        team = {
          id: t.id,
          name: t.name,
          pickup_fee_waived: t.pickupFeeWaived,
          free_lockbox_install: t.freeLockboxInstall,
          members: activeMembers.map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, hasLogin: !!m.userId })),
          memberNames: t.teamMembers.map((m) => ({ id: m.id, name: m.name })),
        }
      }
    }

    // Brokerage inventory link (roster-based; see the brokerage route header).
    const brokerageLink = await prisma.teamMember.findFirst({
      where: { userId: id, removedAt: null },
      select: { teamId: true },
    })

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company_name: customer.company,
        license_number: null,
        role: customer.role,
        is_service_area_exempt: customer.isServiceAreaExempt,
        invoice_billing: customer.invoiceBilling,
        flat_fee_billing: customer.flatFeeBilling,
        // Account-level lockbox perk — the one that applies when this account
        // has no team. The admin screen shows whichever of the two is in play.
        free_lockbox_install: customer.freeLockboxInstall,
        billing_email: customer.billingEmail,
        invoice_discount_percent:
          customer.invoiceDiscountPercent !== null && customer.invoiceDiscountPercent !== undefined
            ? Number(customer.invoiceDiscountPercent)
            : null,
        // Which brokerage's inventory pool this agent draws from, if any.
        // Read off the ROSTER row, not customer.teamId: the link deliberately
        // does not write User.teamId, because that field carries act-as,
        // refund-routing and billing-fallback authority. See
        // app/api/admin/customers/[id]/brokerage/route.ts.
        brokerage_team_id: brokerageLink?.teamId ?? null,
      },
      team,
      inventory: {
        signs,
        riders,
        lockboxes,
        brochureBoxes,
        // Per-row data for the per-agent grouped UI (additive — aggregated shapes above remain for other consumers)
        items: {
          signs: signsRaw.map(s => ({
            id: s.id,
            description: s.description,
            inStorage: s.inStorage,
            assignedToMemberId: s.assignedToMemberId,
          })),
          riders: ridersRaw.map(r => ({
            id: r.id,
            riderName: r.rider.name,
            inStorage: r.inStorage,
            assignedToMemberId: r.assignedToMemberId,
          })),
          lockboxes: lockboxesRaw.map(l => ({
            id: l.id,
            type: l.lockboxType.name,
            code: l.code,
            serialNumber: l.serialNumber,
            inStorage: l.inStorage,
            assignedToMemberId: l.assignedToMemberId,
          })),
          brochureBoxes: brochureBoxesRaw.map(b => ({
            id: b.id,
            description: b.description,
            inStorage: b.inStorage,
            assignedToMemberId: b.assignedToMemberId,
          })),
          // Per-row Other for the team-grouped UI (with per-row Assign dropdown).
          otherItems: otherItemsRaw.map(o => ({
            id: o.id,
            description: o.description,
            assignedToMemberId: o.assignedToMemberId,
          })),
        },
        // Group duplicate (description, assignee) pairs onto one line with a quantity count
        // for the non-grouped legacy view. Assignee in the key prevents two agents'
        // identical-named items from collapsing into one row.
        otherItems: (() => {
          const grouped: Record<string, { id: string; description: string; quantity: number; assignedToMemberId: string | null }> = {}
          for (const item of otherItemsRaw) {
            const key = `${item.description}::${item.assignedToMemberId ?? ''}`
            if (grouped[key]) {
              grouped[key].quantity += 1
            } else {
              grouped[key] = { id: item.id, description: item.description, quantity: 1, assignedToMemberId: item.assignedToMemberId }
            }
          }
          return Object.values(grouped)
        })(),
        deployed,
      },
      orders,
      installations,
    })
  } catch (error) {
    console.error('Error fetching customer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const updateData: Record<string, unknown> = {}

    if (body.full_name !== undefined) updateData.fullName = body.full_name
    if (body.email !== undefined) updateData.email = body.email
    if (body.phone !== undefined) updateData.phone = body.phone
    if (body.company !== undefined) updateData.company = body.company

    // Capture before-value so we can emit an audit row only when it actually flips.
    let exemptChangeAudit: { from: boolean; to: boolean } | null = null
    if (body.is_service_area_exempt !== undefined) {
      const nextExempt = Boolean(body.is_service_area_exempt)
      const cur = await prisma.user.findUnique({
        where: { id },
        select: { isServiceAreaExempt: true },
      })
      if (!cur) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (cur.isServiceAreaExempt !== nextExempt) {
        updateData.isServiceAreaExempt = nextExempt
        exemptChangeAudit = { from: cur.isServiceAreaExempt, to: nextExempt }
      }
    }

    // Billing-contact email — optional override for where bundled invoices
    // get emailed. Stored separately from User.email (login) so brokers can
    // route bills to an accountant without changing their own login email.
    // Empty string from the form means "clear it"; null/missing means "no change".
    if (body.billing_email !== undefined) {
      const raw = typeof body.billing_email === 'string' ? body.billing_email.trim() : ''
      // Minimal shape check — Resend will reject malformed addresses at send
      // time anyway. We just refuse obvious nonsense to avoid storing junk.
      if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return NextResponse.json({ error: 'Billing email is not a valid address.' }, { status: 400 })
      }
      updateData.billingEmail = raw || null
    }

    // Mirror the exempt-flag audit pattern for the invoice-billing toggle.
    let invoiceBillingAudit: { from: boolean; to: boolean } | null = null
    if (body.invoice_billing !== undefined) {
      const nextInvoiceBilling = Boolean(body.invoice_billing)
      const cur = await prisma.user.findUnique({
        where: { id },
        select: { invoiceBilling: true },
      })
      if (!cur) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (cur.invoiceBilling !== nextInvoiceBilling) {
        updateData.invoiceBilling = nextInvoiceBilling
        invoiceBillingAudit = { from: cur.invoiceBilling, to: nextInvoiceBilling }
      }
    }

    // Broker invoice discount — a percentage off this account's bundled
    // invoices. Validated here with the other 400s; money, so it is audited.
    let invoiceDiscountAudit: { from: number | null; to: number | null } | null = null
    if (body.invoice_discount_percent !== undefined) {
      const raw = body.invoice_discount_percent
      const blank = raw === null || (typeof raw === 'string' && raw.trim() === '')
      let next: number | null = null
      if (!blank) {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          return NextResponse.json(
            { error: 'Invoice discount must be a number between 0 and 100.' },
            { status: 400 }
          )
        }
        // Decimal(5,2) — round rather than let the DB reject extra places.
        next = Math.round(parsed * 100) / 100
        if (next === 0) next = null
      }
      const cur = await prisma.user.findUnique({
        where: { id },
        select: { invoiceDiscountPercent: true },
      })
      if (!cur) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      const curNum = cur.invoiceDiscountPercent !== null ? Number(cur.invoiceDiscountPercent) : null
      if (curNum !== next) {
        updateData.invoiceDiscountPercent = next
        invoiceDiscountAudit = { from: curNum, to: next }
      }
    }

    // CR4: flat-fee billing toggle — same audited-delta pattern as above.
    let flatFeeBillingAudit: { from: boolean; to: boolean } | null = null
    if (body.flat_fee_billing !== undefined) {
      const nextFlatFee = Boolean(body.flat_fee_billing)
      const cur = await prisma.user.findUnique({
        where: { id },
        select: { flatFeeBilling: true },
      })
      if (!cur) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (cur.flatFeeBilling !== nextFlatFee) {
        updateData.flatFeeBilling = nextFlatFee
        flatFeeBillingAudit = { from: cur.flatFeeBilling, to: nextFlatFee }
      }
    }

    // Team perks — the $10 sign-pickup waiver (Ryan, 2026-09-15) and the free
    // owned-lockbox install, which until now could only be set by a script.
    // They live on the Team, so they only exist once this account has one.
    // Same audited-delta pattern as the per-user toggles above.
    const teamPerkAudits: Array<{ action: string; from: boolean; to: boolean; teamId: string }> = []
    // Validated here with the other 400s; WRITTEN after the user update below
    // succeeds, so a failed save never leaves a perk changed without its audit.
    let pendingTeamUpdate: { teamId: string; data: { pickupFeeWaived?: boolean; freeLockboxInstall?: boolean } } | null = null
    // The lockbox perk when this account has no Team: held on the account
    // itself so broker logins without a team (the Keller Williams offices)
    // still have a switch. Audited like the other per-user toggles.
    let userFreeLockboxAudit: { from: boolean; to: boolean } | null = null
    if (body.team_pickup_fee_waived !== undefined || body.team_free_lockbox_install !== undefined) {
      const cur = await prisma.user.findUnique({
        where: { id },
        select: {
          teamId: true,
          freeLockboxInstall: true,
          team: { select: { pickupFeeWaived: true, freeLockboxInstall: true } },
        },
      })
      if (!cur) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (!cur.teamId || !cur.team) {
        // The sign-pickup waiver is still team-only — it is enforced against
        // the payer's team in lib/orders/pickup-fee.ts.
        if (body.team_pickup_fee_waived !== undefined) {
          return NextResponse.json(
            { error: 'This account has no team yet, so the sign-pickup waiver cannot be set. Add a team member first.' },
            { status: 400 }
          )
        }
        const next = Boolean(body.team_free_lockbox_install)
        if (cur.freeLockboxInstall !== next) {
          updateData.freeLockboxInstall = next
          userFreeLockboxAudit = { from: cur.freeLockboxInstall, to: next }
        }
      } else {
        const teamData: { pickupFeeWaived?: boolean; freeLockboxInstall?: boolean } = {}
        if (body.team_pickup_fee_waived !== undefined) {
          const next = Boolean(body.team_pickup_fee_waived)
          if (cur.team.pickupFeeWaived !== next) {
            teamData.pickupFeeWaived = next
            teamPerkAudits.push({ action: AuditAction.TeamPickupFeeWaiverToggle, from: cur.team.pickupFeeWaived, to: next, teamId: cur.teamId })
          }
        }
        if (body.team_free_lockbox_install !== undefined) {
          const next = Boolean(body.team_free_lockbox_install)
          if (cur.team.freeLockboxInstall !== next) {
            teamData.freeLockboxInstall = next
            teamPerkAudits.push({ action: AuditAction.TeamFreeLockboxToggle, from: cur.team.freeLockboxInstall, to: next, teamId: cur.teamId })
          }
          // Pricing ORs the two sources, so a leftover account-level flag —
          // set while this account had no team — would keep granting free
          // installs that the team checkbox can never switch off. The team is
          // authoritative once it exists; clear the account copy with it.
          if (cur.freeLockboxInstall && !next) {
            updateData.freeLockboxInstall = false
            userFreeLockboxAudit = { from: true, to: false }
          }
        }
        if (Object.keys(teamData).length > 0) {
          pendingTeamUpdate = { teamId: cur.teamId, data: teamData }
        }
      }
    }

    let roleChangeAudit: { from: string; to: AllowedRole } | null = null
    if (body.role !== undefined) {
      // Defense in depth: even though the route is already gated to admins
      // above, re-check at the sensitive operation so future refactors that
      // loosen the outer gate don't accidentally expose role changes.
      if (user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Only platform admins can change roles' },
          { status: 403 }
        )
      }
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json(
          { error: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      if (id === user.id) {
        return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
      }
      const current = await prisma.user.findUnique({ where: { id }, select: { role: true } })
      if (!current) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (current.role !== body.role) {
        // Prevent last-admin lockout: refuse to demote the only remaining admin.
        if (current.role === 'admin' && body.role !== 'admin') {
          const remainingAdmins = await prisma.user.count({
            where: { role: 'admin', id: { not: id } },
          })
          if (remainingAdmins === 0) {
            return NextResponse.json(
              { error: 'Cannot demote the last remaining admin. Promote another user to admin first.' },
              { status: 400 }
            )
          }
        }
        updateData.role = body.role
        roleChangeAudit = { from: current.role, to: body.role }

        // NO billing cascade on promotion. This used to default
        // invoice_billing to ON whenever a caller promoted someone into
        // team_admin without an opinion, on the assumption that every
        // brokerage bills net-30.
        //
        // That assumption broke with linked brokerage inventory (Ryan,
        // 2026-09-08): brokerages are now promoted purely so agents can draw
        // from their sign pool, and Ryan was explicit that the link is
        // "only ... an inventory link, not a pay link". The new brokerages
        // pay by card. Silently moving them to net-30 would stop charging
        // them at checkout and quietly accrue an unbilled balance.
        //
        // Billing mode is now always an explicit decision: the admin UI sends
        // invoice_billing on every PUT, and a scripted caller that omits it
        // leaves the existing value alone.
      }
    }

    const customer = await prisma.user.update({
      where: { id },
      data: updateData,
    })

    if (pendingTeamUpdate) {
      await prisma.team.update({
        where: { id: pendingTeamUpdate.teamId },
        data: pendingTeamUpdate.data,
        select: { id: true },
      })
    }

    // Invariant: only ordinary customer accounts may draw from a brokerage
    // pool. Promoting someone out of 'customer' releases any brokerage link
    // here, server-side, rather than relying on the admin UI to sequence two
    // requests correctly -- the brokerage route rejects non-customer targets,
    // so a UI that PUT the role first could never unlink afterwards and the
    // account would be stranded pointing at a brokerage with no way to undo it.
    // Release, don't delete: the roster row reverts to name-only and keeps its
    // history.
    if (customer.role !== 'customer') {
      // Capture the team first so the audit row can say which brokerage the
      // agent lost access to -- updateMany cannot return it.
      const priorLink = await prisma.teamMember.findFirst({
        where: { userId: id },
        select: { id: true, teamId: true },
      })
      if (priorLink) {
        await prisma.teamMember.updateMany({ where: { userId: id }, data: { userId: null } })
        // Audited for the same reason as the roster-removal path: a silent
        // revocation leaves the log claiming access that no longer exists.
        await audit({
          action: AuditAction.AgentLinkedToBrokerage,
          targetType: 'user',
          targetId: id,
          actor: user,
          request,
          metadata: { from: priorLink.teamId, to: null, via: 'role_change', member_id: priorLink.id },
        })
      }
    }

    if (roleChangeAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserRoleChange,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...roleChangeAudit },
        request,
      })
    }

    if (exemptChangeAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserExemptToggle,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...exemptChangeAudit },
        request,
      })
    }

    if (invoiceBillingAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserInvoiceBillingToggle,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...invoiceBillingAudit },
        request,
      })
    }

    if (flatFeeBillingAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserFlatFeeBillingToggle,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...flatFeeBillingAudit },
        request,
      })
    }

    if (invoiceDiscountAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserInvoiceDiscountChange,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...invoiceDiscountAudit },
        request,
      })
    }

    if (userFreeLockboxAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserFreeLockboxToggle,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...userFreeLockboxAudit },
        request,
      })
    }

    for (const perk of teamPerkAudits) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: perk.action,
        targetType: 'team',
        targetId: perk.teamId,
        metadata: { email: customer.email, from: perk.from, to: perk.to },
        request,
      })
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company: customer.company,
        role: customer.role,
      },
    })
  } catch (error) {
    console.error('Error updating customer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Prevent deleting yourself
    if (id === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting customer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
