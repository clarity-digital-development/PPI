'use client'

import { useState, useEffect, useCallback } from 'react'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Badge, Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui'
import { AddCardModal, PaymentMethodCard } from '@/components/billing'
import { CreditCard, Plus, CheckCircle, Receipt, Loader2 } from 'lucide-react'

interface PaymentMethod {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
  nickname: string | null
}

interface Order {
  id: string
  order_number: string
  status: string
  payment_status: string
  property_address: string
  property_city: string
  property_state: string
  subtotal: number
  fuel_surcharge: number
  expedite_fee: number
  total: number
  created_at: string
  paid_at: string | null
  order_items: Array<{
    description: string
    quantity: number
    total_price: number
  }>
}

export default function BillingPage() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [showAddCard, setShowAddCard] = useState(false)

  const fetchPaymentMethods = useCallback(async () => {
    setLoadingCards(true)
    try {
      const res = await fetch('/api/stripe/payment-methods')
      if (res.ok) {
        const data = await res.json()
        setPaymentMethods(data.paymentMethods)
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error)
    } finally {
      setLoadingCards(false)
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch('/api/orders?status=completed')
      if (res.ok) {
        const data = await res.json()
        setOrders(data.orders.filter((o: Order) => o.payment_status === 'succeeded'))
      }
    } catch (error) {
      console.error('Error fetching orders:', error)
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  useEffect(() => {
    fetchPaymentMethods()
    fetchOrders()
  }, [fetchPaymentMethods, fetchOrders])

  const handleDeleteCard = async (paymentMethodId: string) => {
    try {
      const res = await fetch(`/api/stripe/payment-methods/${paymentMethodId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        fetchPaymentMethods()
      } else {
        alert('Failed to remove card')
      }
    } catch (error) {
      console.error('Error deleting card:', error)
      alert('Failed to remove card')
    }
  }

  const handleSetDefault = async (paymentMethodId: string) => {
    try {
      const res = await fetch(`/api/stripe/payment-methods/${paymentMethodId}`, {
        method: 'PATCH',
      })

      if (res.ok) {
        fetchPaymentMethods()
      } else {
        alert('Failed to set default card')
      }
    } catch (error) {
      console.error('Error setting default:', error)
      alert('Failed to set default card')
    }
  }

  // Throws on failure so the card's rename box stays open with the text.
  const handleRename = async (paymentMethodId: string, nickname: string) => {
    const res = await fetch(`/api/stripe/payment-methods/${paymentMethodId}/nickname`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "Couldn't save the nickname.")
    setPaymentMethods((prev) => prev.map((pm) => (pm.id === paymentMethodId ? { ...pm, nickname: data.nickname ?? null } : pm)))
  }

  const handleAddCardSuccess = () => {
    setShowAddCard(false)
    fetchPaymentMethods()
  }

  return (
    <div>
      <Header title="Billing" />

      <div className="p-6">
        <Tabs defaultValue="payment-methods">
          <TabsList className="mb-6">
            <TabsTrigger value="payment-methods">
              <CreditCard className="w-4 h-4 mr-2" />
              Payment Methods
            </TabsTrigger>
            <TabsTrigger value="history">
              <Receipt className="w-4 h-4 mr-2" />
              Payment History
            </TabsTrigger>
          </TabsList>

          {/* Payment Methods Tab */}
          <TabsContent value="payment-methods">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Saved Cards</h2>
                  <p className="text-sm text-gray-500">
                    Manage your payment methods for automatic billing
                  </p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => setShowAddCard(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Card
                </Button>
              </div>

              {loadingCards ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
                </div>
              ) : paymentMethods.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center">
                    <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      No Payment Methods
                    </h3>
                    <p className="text-gray-500 mb-4">
                      Add a card to enable automatic billing for your orders
                    </p>
                    <Button variant="primary" onClick={() => setShowAddCard(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Your First Card
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {paymentMethods.map((pm) => (
                    <PaymentMethodCard
                      key={pm.id}
                      paymentMethod={pm}
                      onDelete={handleDeleteCard}
                      onSetDefault={handleSetDefault}
                      onRename={handleRename}
                    />
                  ))}
                </div>
              )}

              {/* Info box */}
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-900">How automatic billing works</h4>
                      <p className="text-sm text-blue-700 mt-1">
                        When you place an order, your default payment method will be charged
                        automatically once the order is completed. You&apos;ll receive an email receipt
                        for each transaction.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Payment History Tab */}
          <TabsContent value="history">
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Payment History</h2>
                <p className="text-sm text-gray-500">
                  View all your past payments and order details
                </p>
              </div>

              {loadingOrders ? (
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
                </div>
              ) : orders.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center">
                    <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No payment history yet</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Completed orders will appear here
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <Card key={order.id}>
                      <CardContent className="p-0">
                        {/* Order Header */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between p-4 border-b border-gray-100">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-900">
                                {order.order_number}
                              </span>
                              <Badge variant="success" className="gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Paid
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {order.property_address}, {order.property_city}, {order.property_state}
                            </p>
                          </div>
                          <div className="mt-2 md:mt-0 text-sm text-gray-500">
                            {order.paid_at
                              ? new Date(order.paid_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })
                              : new Date(order.created_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                          </div>
                        </div>

                        {/* Order Items */}
                        <div className="p-4">
                          <div className="space-y-2">
                            {order.order_items.map((item, index) => (
                              <div
                                key={index}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-gray-600">
                                  {item.description}
                                  {item.quantity > 1 && ` (x${item.quantity})`}
                                </span>
                                <span className="text-gray-900">
                                  ${item.total_price.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Fees & Total */}
                          <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Subtotal</span>
                              <span className="text-gray-900">${order.subtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">Fuel Surcharge</span>
                              <span className="text-gray-900">${order.fuel_surcharge.toFixed(2)}</span>
                            </div>
                            {order.expedite_fee > 0 && (
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-600">Expedite Fee</span>
                                <span className="text-gray-900">${order.expedite_fee.toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                              <span className="font-medium text-gray-900">Total Paid</span>
                              <span className="text-lg font-bold text-pink-600">
                                ${order.total.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Card Modal */}
      <AddCardModal
        isOpen={showAddCard}
        onClose={() => setShowAddCard(false)}
        onSuccess={handleAddCardSuccess}
      />
    </div>
  )
}
