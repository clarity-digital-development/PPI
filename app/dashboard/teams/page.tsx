'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button, Input, Badge, Modal } from '@/components/ui'
import {
  Loader2,
  AlertCircle,
  Users,
  UserPlus,
  Pencil,
  Trash2,
  Check,
  X,
  Mail,
  Phone,
} from 'lucide-react'

interface TeamMember {
  id: string
  name: string
  email: string | null
  phone: string | null
  hasLogin: boolean
  userId: string | null
}

interface Team {
  id: string
  name: string
}

export default function TeamsPage() {
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create-team empty state
  const [newTeamName, setNewTeamName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Inline rename
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [savingRename, setSavingRename] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  // Add/Edit member modal
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [memberForm, setMemberForm] = useState({ name: '', email: '', phone: '' })
  const [savingMember, setSavingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  // Remove member
  const [removingId, setRemovingId] = useState<string | null>(null)

  const fetchTeam = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/teams')
      if (!res.ok) {
        throw new Error('Failed to load your team')
      }

      const data = await res.json()
      setTeam(data.team || null)
      setMembers(data.members || [])
    } catch (err) {
      console.error('Error fetching team:', err)
      setError(err instanceof Error ? err.message : 'Failed to load your team')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTeam()
  }, [])

  const createTeam = async () => {
    const name = newTeamName.trim()
    if (!name) {
      setCreateError('Team name is required')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create team')
      }

      setNewTeamName('')
      await fetchTeam()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setCreating(false)
    }
  }

  const startRename = () => {
    setRenameError(null)
    setRenameValue(team?.name || '')
    setRenaming(true)
  }

  const cancelRename = () => {
    setRenaming(false)
    setRenameError(null)
  }

  const saveRename = async () => {
    const name = renameValue.trim()
    if (!name) {
      setRenameError('Team name is required')
      return
    }

    setSavingRename(true)
    setRenameError(null)
    try {
      const res = await fetch('/api/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to rename team')
      }

      const data = await res.json()
      setTeam(data.team)
      setRenaming(false)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename team')
    } finally {
      setSavingRename(false)
    }
  }

  const openAddMember = () => {
    setMemberError(null)
    setEditingMember(null)
    setMemberForm({ name: '', email: '', phone: '' })
    setShowMemberModal(true)
  }

  const openEditMember = (member: TeamMember) => {
    setMemberError(null)
    setEditingMember(member)
    setMemberForm({
      name: member.name || '',
      email: member.email || '',
      phone: member.phone || '',
    })
    setShowMemberModal(true)
  }

  const closeMemberModal = () => {
    setShowMemberModal(false)
    setEditingMember(null)
    setMemberError(null)
  }

  const saveMember = async () => {
    const name = memberForm.name.trim()
    if (!name) {
      setMemberError('Member name is required')
      return
    }

    setSavingMember(true)
    setMemberError(null)
    try {
      const url = editingMember
        ? `/api/teams/members/${editingMember.id}`
        : '/api/teams/members'
      const method = editingMember ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: memberForm.email.trim(),
          phone: memberForm.phone.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save member')
      }

      closeMemberModal()
      await fetchTeam()
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to save member')
    } finally {
      setSavingMember(false)
    }
  }

  const removeMember = async (member: TeamMember) => {
    if (!window.confirm(`Remove ${member.name} from your team? This cannot be undone.`)) {
      return
    }

    setRemovingId(member.id)
    try {
      const res = await fetch(`/api/teams/members/${member.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to remove member')
      }

      await fetchTeam()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="My Team" />
        <div className="p-6 flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
            <p className="text-gray-500">Loading your team...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Header title="My Team" />
        <div className="p-6">
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-6 text-center">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
              <p className="text-red-700">{error}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Empty state — no team yet
  if (!team) {
    return (
      <div>
        <Header title="My Team" />
        <div className="p-6">
          <Card variant="bordered" className="max-w-lg mx-auto">
            <CardContent className="p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-pink-100 flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-pink-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Create your team</h3>
              <p className="text-gray-500 mb-6">
                Set up your team to start adding members and managing your roster.
              </p>
              <div className="text-left space-y-4">
                <Input
                  label="Team name"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g., The Smith Group"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createTeam()
                  }}
                />
                {createError && <p className="text-sm text-error">{createError}</p>}
                <Button
                  className="w-full"
                  onClick={createTeam}
                  isLoading={creating}
                >
                  Create team
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="My Team" />

      <div className="p-6 space-y-6">
        {/* Team name + rename */}
        <Card variant="bordered">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-pink-500 shrink-0" />
              {renaming ? (
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Team name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveRename} isLoading={savingRename}>
                      <Check className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={cancelRename}
                      disabled={savingRename}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 flex-1 truncate">
                    {team.name}
                  </h2>
                  <Button variant="outline" size="sm" onClick={startRename}>
                    <Pencil className="w-4 h-4 mr-1.5" />
                    Rename
                  </Button>
                </>
              )}
            </div>
            {renaming && renameError && (
              <p className="mt-2 text-sm text-error">{renameError}</p>
            )}
          </CardContent>
        </Card>

        {/* Team Members */}
        <Card variant="bordered">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">
                Team Members{' '}
                <span className="text-sm font-normal text-gray-500">
                  ({members.length})
                </span>
              </h2>
              <Button size="sm" onClick={openAddMember}>
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add member
              </Button>
            </div>

            {members.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No members yet</h3>
                <p className="text-gray-500">
                  Add your first team member to start building your roster.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{member.name}</p>
                        <Badge variant={member.hasLogin ? 'success' : 'neutral'}>
                          {member.hasLogin ? 'Login' : 'Name only'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                        {member.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5" />
                            {member.email}
                          </span>
                        )}
                        {member.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" />
                            {member.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditMember(member)}
                      >
                        <Pencil className="w-4 h-4 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        isLoading={removingId === member.id}
                        onClick={() => removeMember(member)}
                      >
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Member Modal */}
      <Modal
        isOpen={showMemberModal}
        onClose={closeMemberModal}
        title={editingMember ? 'Edit Member' : 'Add Member'}
      >
        <div className="space-y-4">
          <Input
            label="Name *"
            value={memberForm.name}
            onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
            placeholder="e.g., Jane Smith"
          />
          <Input
            label="Email"
            type="email"
            value={memberForm.email}
            onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
            placeholder="jane@example.com"
          />
          <Input
            label="Phone"
            value={memberForm.phone}
            onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
            placeholder="859-555-1234"
          />

          {memberError && <p className="text-sm text-error">{memberError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={closeMemberModal} disabled={savingMember}>
              Cancel
            </Button>
            <Button onClick={saveMember} isLoading={savingMember}>
              {editingMember ? 'Save Changes' : 'Add Member'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
