import { encode } from '@borderless/base64'
import { Models, Synchronization } from '@polycentric/polycentric-core'
import { ReactNode, useEffect, useState } from 'react'
import internetTodayURL from '../../../../graphics/onboarding/internettoday.svg'
import starterURL from '../../../../graphics/onboarding/starter.svg'
import { useOnboardingProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import { useThemeColor } from '../../../hooks/styleHooks'

import { publishBlobToAvatar } from '../../../util/imageProcessing'
import { ProfileAvatarInput } from '../../profile/edit/inputs/ProfileAvatarInput'
import { Carousel } from '../../util/carousel'

const OnboardingPanel = ({ children, imgSrc }: { children: ReactNode; nextSlide: () => void; imgSrc: string }) => (
  <div className="relative h-screen md:h-auto w-full flex flex-col justify- md:grid md:grid-cols-2 md:grid-rows-1 md:gap-5 md:px-14 md:py-10">
    <div className="border rounded-[2.5rem] bg-white">{children}</div>
    {/* Desktop graphic */}
    <br className="md:hidden" />
    <div className="hidden md:block w-full justify-center bg-[#0096E6] max-h-72 md:max-h-none rounded-[2.5rem] overflow-hidden">
      <img className="h-full" src={imgSrc} />
    </div>
    {/* Mobile graphic */}
    <div className="md:hidden absolute top-0 left-0 w-full h-full flex flex-col justify-end items-center bg-[#0096E6] -z-10">
      <img className="h-1/2" src={imgSrc} />
    </div>
  </div>
)

const WelcomePanel = ({ nextSlide }: { nextSlide: () => void }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={starterURL}>
    <div className="flex flex-col justify-center h-full text-left p-10 space-y-10 md:space-y-4">
      <div className="text-4xl md:font-6xl font-bold">Welcome to Polycentric</div>
      <div className="text-gray-400 text-lg">Posting for communities</div>
      <button
        className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
        onClick={nextSlide}
      >
        Try it (no email needed)
      </button>
    </div>
  </OnboardingPanel>
)

const InternetTodayPanel = ({ nextSlide }: { nextSlide: () => void }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={internetTodayURL}>
    <div className="flex flex-col p-10 gap-y-10">
      <div className="text-4xl font-bold">This is the internet today</div>
      <p className="text-xl">
        Two guys in California control every piece of content you see. If you hurt their feelings, youre out.
      </p>
      <p className="text-xl">
        Polycentric was developed with a love for the old internet, built around communities and respect for you.
      </p>
      <button
        className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
        onClick={nextSlide}
      >
        Lets go back
      </button>
    </div>
  </OnboardingPanel>
)

const RequestNotificationsPanel = ({ nextSlide }: { nextSlide: () => void }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={starterURL}>
    <div className="flex flex-col p-10 gap-y-10">
      <div className="text-4xl font-bold">Enable Notifications</div>
      <p className="text-xl">We need you to enable notifications because chrome is stupid.</p>
      <button
        className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
        onClick={async () => {
          const permission = await Notification.requestPermission()
          if (permission === 'denied') console.error('Notifications denied')
          await navigator.storage.persist()

          nextSlide()
        }}
      >
        Enable notifications
      </button>
    </div>
  </OnboardingPanel>
)

const GenCredsPanelItem = ({
  value,
  onChange,
  title,
  hint,
  autoComplete,
  readOnly = false,
}: {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  title: string
  hint?: string
  autoComplete?: string
  readOnly?: boolean
}) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <input
      type="text"
      className="rounded-lg border text-xl p-3"
      autoComplete={autoComplete}
      readOnly={readOnly}
      value={value}
      onChange={onChange}
    />
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
)

const GenCredsPanel = ({ nextSlide }: { nextSlide: () => void }) => {
  const [avatar, setAvatar] = useState<Blob>()
  const [privateKey] = useState(Models.PrivateKey.random())
  const [username, setUsername] = useState('')
  const { createHandle: createAccount } = useOnboardingProcessHandleManager()

  return (
    <OnboardingPanel nextSlide={nextSlide} imgSrc={starterURL}>
      <div className="flex flex-col justify-center h-full p-10 gap-y-5">
        <form
          className="flex flex-col gap-y-5"
          onSubmit={async (e) => {
            e.preventDefault()

            const defaultServers: Array<string> = import.meta.env.VITE_DEFAULT_SERVERS?.split(',') ?? []
            const processHandle = await createAccount(privateKey, defaultServers, username)

            if (avatar) await publishBlobToAvatar(avatar, processHandle)

            await Synchronization.backFillServers(processHandle, processHandle.system())

            // if supported, save private key to credential manager api
            // @ts-ignore
            if (window.PasswordCredential) {
              // @ts-ignore
              const cred = new window.PasswordCredential({
                name: username,
                id: encode(processHandle.system().key),
                password: encode(privateKey.key),
              })
              navigator.credentials.store(cred)
            }
          }}
        >
          <ProfileAvatarInput
            title="Upload a profile picture (optional)"
            hint="You can change this later"
            setImage={setAvatar}
          />
          <GenCredsPanelItem
            title="What's your username?"
            hint="You can change this later"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <GenCredsPanelItem
            title="This is your password. Save it now."
            autoComplete="password"
            value={encode(privateKey.key)}
            readOnly={true}
          />
          <button
            type="submit"
            className="bg-blue-500 text-white border rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
          >
            Lets go
          </button>
        </form>
      </div>
    </OnboardingPanel>
  )
}

export const Onboarding = () => {
  useThemeColor('#0096E6')

  const isChromium = navigator.userAgent.includes('Chrome')

  useEffect(() => {
    const isChromium = navigator.userAgent.includes('Chrome')
    if (isChromium === false) {
      navigator.storage.persist()
    }
  }, [])

  const childComponents = [
    WelcomePanel,
    // I literally submitted a proposal to the EMCAscript spec to avoid this syntax but it got rejected
    // https://es.discourse.group/t/conditionally-add-elements-to-declaratively-defined-arrays/1041
    ...(isChromium ? [RequestNotificationsPanel] : []),
    InternetTodayPanel,
    GenCredsPanel,
  ]

  return (
    <div className="md:flex justify-center items-center">
      <Carousel childComponents={childComponents} className="w-full md:max-w-7xl" />
    </div>
  )
}
