import { encode } from '@borderless/base64'
import { Models } from '@polycentric/polycentric-core'
import { useEffect, useState } from 'react'
import internetTodayURL from '../../../../graphics/onboarding/internettoday.svg'
import starterURL from '../../../../graphics/onboarding/starter.svg'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import { publishBlobToAvatar } from '../../../util/imageConversion'
import { Carousel } from '../../util/carousel'

const OnboardingPanel = ({ children, imgSrc }: { children: JSX.Element; nextSlide: () => void; imgSrc: string }) => (
  <div className="w-full flex flex-col-reverse md:grid md:grid-cols-2 md:grid-rows-1 md:gap-5 md:px-14 md:py-10">
    <div className=" border rounded-[2.5rem]">{children}</div>
    <br className="md:hidden" />
    <div className="w-full flex justify-center bg-[#0096E6] max-h-72 md:max-h-none rounded-[2.5rem] overflow-hidden">
      <img className="h-full" src={imgSrc} />
    </div>
  </div>
)

const WelcomePanel = ({ nextSlide }: { nextSlide: () => void }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={starterURL}>
    <div className="flex flex-col justify-around h-full text-left p-10 space-y-4 md:space-y-4">
      <div className="text-4xl md:font-6xl font-bold">Welcome to Polycentric</div>
      <div className="text-gray-400 text-lg">Posting for communities, not controlled by one guy in San Fransisco</div>
      <button
        className="bg-blue-500 text-white border shadow rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
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
        className="bg-blue-500 text-white border shadow rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
        onClick={nextSlide}
      >
        Lets go back
      </button>
    </div>
  </OnboardingPanel>
)

const RequestNotificationsPanel = ({ nextSlide }: { nextSlide: () => void }) => {
  return (
    <div>
      {/* TODO: Good explination */}
      <p>We need you to enable notifications because chrome is stupid</p>
      <button
        onClick={() => {
          Notification.requestPermission()
          nextSlide()
        }}
      >
        Enable notifications
      </button>
    </div>
  )
}

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

// copy this but for a profile image upload, with a small circle with an upload symbol (just put "u" fo for now) that switches to the uploaded image and an x that appears next to it to remove it

const GenCredsPanelImageUpload = ({
  title,
  hint,
  value,
  setImage,
}: {
  title: string
  hint?: string
  value?: File
  setImage: (image?: File) => void
}) => {
  const [imageURL, setImageURL] = useState<string | undefined>(undefined)

  useEffect(() => {
    let currentURL: string | undefined
    if (value) {
      currentURL = URL.createObjectURL(value)
      setImageURL(currentURL)
    }
    return () => {
      if (currentURL) URL.revokeObjectURL(currentURL)
    }
  }, [value])

  return (
    <div className="flex flex-col gap-y-1">
      <h3 className="font-medium">{title}</h3>
      <div className="relative w-16 h-16 rounded-full border overflow-hidden">
        <img src={imageURL} alt="uploaded profile" className="absolute w-full h-full object-cover" />
        <button className="absolute top-0 right-0 bg-red-500 w-4 h-4 rounded-full" onClick={() => setImage(undefined)}>
          x
        </button>
        <label
          htmlFor="upload-button"
          className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white"
        >
          u
        </label>
        <input id="upload-button" type="file" className="hidden" onChange={(e) => setImage(e.target.files?.[0])} />
      </div>
      <p className="text-sm text-gray-700">{hint}</p>
    </div>
  )
}

const GenCredsPanel = ({ nextSlide }: { nextSlide: () => void }) => {
  const [avatar, setAvatar] = useState<File>()
  const [privateKey] = useState(Models.PrivateKey.random())
  const [username, setUsername] = useState('')
  const { createHandle: createAccount } = useProcessHandleManager()

  return (
    <OnboardingPanel nextSlide={nextSlide} imgSrc={internetTodayURL}>
      <div className="flex flex-col justify-center h-full p-10 gap-y-5">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            // if supported, save private key to credential manager api
            // @ts-ignore
            if (window.PasswordCredential) {
              // @ts-ignore
              const cred = new window.PasswordCredential({
                name: 'asfafs',
                id: 'asfafs',
                password: 'fsdkjflsdf',
              })
              navigator.credentials.store(cred)
            }

            debugger
            const processHandle = await createAccount(privateKey)
            processHandle.setUsername(username)
            if (avatar) console.log(await publishBlobToAvatar(avatar, processHandle))
          }}
        >
          <GenCredsPanelImageUpload
            title="Upload a profile picture (optional)"
            hint="You can change this later"
            value={avatar}
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
            className="bg-blue-500 text-white border shadow rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
          >
            Lets go
          </button>
        </form>
      </div>
    </OnboardingPanel>
  )
}

export const Onboarding = () => (
  <Carousel
    childComponents={[WelcomePanel, RequestNotificationsPanel, InternetTodayPanel, GenCredsPanel]}
    itemClassName="md:h-[830px]"
  />
)
