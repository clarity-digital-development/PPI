'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui'
import { PropertyStep } from './steps/property-step'
import { PostStep } from './steps/post-step'
import { SignStep } from './steps/sign-step'
import { RiderStep } from './steps/rider-step'
import { LockboxStep } from './steps/lockbox-step'
import { BrochureBoxStep } from './steps/brochure-box-step'
import { SchedulingStep } from './steps/scheduling-step'
import { ReviewStep } from './steps/review-step'
import type { OrderFormData } from './types'

const steps = [
  { id: 'property', title: 'Property Info', component: PropertyStep },
  { id: 'post', title: 'Post Selection', component: PostStep },
  { id: 'sign', title: 'Sign', component: SignStep },
  { id: 'rider', title: 'Riders', component: RiderStep },
  { id: 'lockbox', title: 'Lockbox', component: LockboxStep },
  { id: 'brochure', title: 'Brochure Box', component: BrochureBoxStep },
  { id: 'scheduling', title: 'Scheduling', component: SchedulingStep },
  { id: 'review', title: 'Review & Pay', component: ReviewStep },
]

const initialFormData: OrderFormData = {
  // Property
  property_type: undefined,
  property_address: '',
  property_city: '',
  property_state: 'KY',
  property_zip: '',
  installation_location: '',
  installation_notes: '',
  // Additional Property Questions
  is_gated_community: false,
  gate_code: '',
  has_marker_placed: false,
  sign_orientation: 'installer_decides',
  sign_orientation_other: '',
  // Post
  post_type: undefined,
  // Sign
  sign_option: 'none',
  stored_sign_id: undefined,
  sign_description: '',
  // Riders
  riders: [],
  // Wire Frame Signs
  wire_frame_quantity: 0,
  wire_frame_notes: undefined,
  // Lockbox
  lockbox_option: 'none',
  lockbox_type: undefined,
  lockbox_code: '',
  // Brochure box
  brochure_option: 'none',
  // Scheduling
  schedule_type: 'next_available',
  requested_date: undefined,
  // Payment
  payment_method_id: undefined,
  save_payment_method: false,
}

interface OrderWizardProps {
  inventory?: {
    signs: Array<{ id: string; description: string; size: string | null }>
    riders: Array<{ id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
    brochureBoxes: { quantity: number } | null
  }
  paymentMethods?: Array<{
    id: string
    card_brand: string | null
    card_last4: string | null
    is_default: boolean
  }>
}

export function OrderWizard({ inventory, paymentMethods }: OrderWizardProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [highestStep, setHighestStep] = useState(0) // Track furthest step reached
  const [formData, setFormData] = useState<OrderFormData>(initialFormData)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateFormData = useCallback((updates: Partial<OrderFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }))
  }, [])

  const goToNextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      const nextStep = currentStep + 1
      setCurrentStep(nextStep)
      setHighestStep((prev) => Math.max(prev, nextStep))
    }
  }, [currentStep])

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  const goToStep = useCallback((stepIndex: number) => {
    // Allow going to any step that has been visited (up to highestStep)
    if (stepIndex <= highestStep) {
      setCurrentStep(stepIndex)
    }
  }, [highestStep])

  const canProceed = useCallback(() => {
    const step = steps[currentStep]
    switch (step.id) {
      case 'property':
        const gateCodeValid = !formData.is_gated_community || formData.gate_code
        const orientationValid = formData.sign_orientation !== 'other' || formData.sign_orientation_other
        return (
          formData.property_type &&
          formData.property_address &&
          formData.property_city &&
          formData.property_zip &&
          formData.sign_orientation &&
          gateCodeValid &&
          orientationValid
        )
      case 'post':
        return true // Post is now optional
      case 'sign':
      case 'rider':
      case 'lockbox':
      case 'brochure':
        return true // Optional steps
      case 'scheduling':
        return formData.schedule_type === 'next_available' || formData.requested_date
      case 'review':
        return true
      default:
        return true
    }
  }, [currentStep, formData])

  const CurrentStepComponent = steps[currentStep].component

  return (
    <div className="max-w-4xl mx-auto">
      {/* Progress Steps - Mobile: simplified, Desktop: full */}
      <div className="mb-8">
        {/* Mobile Progress Bar */}
        <div className="md:hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">
              Step {currentStep + 1} of {steps.length}
            </span>
            <span className="text-sm text-pink-600 font-medium">
              {steps[currentStep].title}
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-pink-500 transition-all duration-300"
              style={{ width: `${((highestStep + 1) / steps.length) * 100}%` }}
            />
          </div>
          {/* Mobile step dots for quick navigation */}
          <div className="flex justify-center gap-1.5 mt-2">
            {steps.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goToStep(index)}
                disabled={index > highestStep}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  index === currentStep
                    ? 'bg-pink-500 scale-125'
                    : index <= highestStep
                    ? 'bg-pink-300 hover:bg-pink-400 cursor-pointer'
                    : 'bg-gray-200 cursor-not-allowed'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Desktop Step Indicator */}
        <div className="hidden md:flex items-center justify-between">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}
            >
              <div className="relative flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => goToStep(index)}
                  disabled={index > highestStep}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    index === currentStep
                      ? 'bg-pink-500 text-white ring-4 ring-pink-200'
                      : index <= highestStep
                      ? 'bg-pink-500 text-white hover:bg-pink-600 cursor-pointer'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {index < currentStep && index <= highestStep ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    index + 1
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => goToStep(index)}
                  disabled={index > highestStep}
                  className={`absolute -bottom-6 whitespace-nowrap text-xs transition-colors ${
                    index === currentStep
                      ? 'text-gray-900 font-semibold'
                      : index <= highestStep
                      ? 'text-gray-900 hover:text-pink-600 cursor-pointer'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {step.title}
                </button>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    index < highestStep ? 'bg-pink-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-6 md:p-8 mt-4 md:mt-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <CurrentStepComponent
              formData={formData}
              updateFormData={updateFormData}
              inventory={inventory}
              paymentMethods={paymentMethods}
              isSubmitting={isSubmitting}
              setIsSubmitting={setIsSubmitting}
            />
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
          <Button
            variant="outline"
            onClick={goToPreviousStep}
            disabled={currentStep === 0}
            className="gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>

          {currentStep < steps.length - 1 ? (
            <Button
              onClick={goToNextStep}
              disabled={!canProceed()}
              className="gap-2"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
