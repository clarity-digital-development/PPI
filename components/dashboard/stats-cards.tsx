import Link from 'next/link'
import { Card, CardContent } from '@/components/ui'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  trend?: {
    value: number
    isPositive: boolean
  }
  className?: string
  // When set, the whole card becomes a link to the page that lists these items.
  href?: string
}

const StatCard = ({ label, value, icon: Icon, trend, className, href }: StatCardProps) => {
  const card = (
    <Card
      variant="bordered"
      className={cn(
        'overflow-hidden h-full',
        href && 'transition-shadow hover:shadow-md hover:border-pink-300',
        className
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
            {trend && (
              <p
                className={cn(
                  'mt-2 text-sm font-medium',
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {trend.isPositive ? '+' : '-'}{trend.value}%{' '}
                <span className="text-gray-500 font-normal">from last month</span>
              </p>
            )}
          </div>
          <div className="p-3 bg-pink-100 rounded-lg">
            <Icon className="w-6 h-6 text-pink-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  )
}

interface StatsCardsProps {
  stats: StatCardProps[]
}

const StatsCards = ({ stats }: StatsCardsProps) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  )
}

export { StatsCards, StatCard }
