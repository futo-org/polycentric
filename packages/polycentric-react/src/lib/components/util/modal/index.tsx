import { Dialog, Transition } from '@headlessui/react'
import { IonModal } from '@ionic/react'
import { Fragment } from 'react'
import { useIsMobile } from '../../../hooks/styleHooks'
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
    <path
      fillRule="evenodd"
      d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
)

export const Modal = ({
  children,
  setOpen,
  open,
  title,
}: {
  children: React.ReactNode
  setOpen: (open: boolean) => void
  open: boolean
  title?: string
}): JSX.Element => {
  const isMobile = useIsMobile('md')

  if (isMobile) {
    return (
      <IonModal isOpen={open}>
        <div className="flex flex-col h-screen bg-white">
          <div className="flex justify-between items-center py-5 px-7">
            <h1 className="text-2xl font-semibold leading-6 text-gray-900">{title}</h1>
            <button
              className="flex items-center rounded-full hover:bg-gray-50 border p-2"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <XIcon />
            </button>
          </div>
          <div className="flex-grow px-7 ">{children}</div>
        </div>
      </IonModal>
    )
  }

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={() => setOpen(false)}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-100"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-50"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-400 bg-opacity-40" onClick={() => setOpen(false)} />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-100"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-50"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="transform overflow-hidden rounded-2xl bg-white border py-3 pb-6 px-9 text-left align-middle shadow-xl transition-all">
                <div className="flex justify-between items-center py-3">
                  <Dialog.Title className="text-2xl font-semibold leading-6 text-gray-900">{title}</Dialog.Title>
                  <button
                    className="flex items-center rounded-full hover:bg-gray-50 border p-2"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  >
                    <XIcon />
                  </button>
                </div>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
