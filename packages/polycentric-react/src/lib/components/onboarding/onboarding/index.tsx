import starterURL from '../../../../graphics/onboarding/starter.svg'
import internetTodayURL from '../../../../graphics/onboarding/internettoday.svg'
import { Carousel } from '../../util/carousel'

const OnboardingPanel = ({
  children,
  nextSlide,
  imgSrc,
}: {
  children: JSX.Element
  nextSlide: any
  imgSrc: string
}) => (
  <div className="w-full flex flex-col-reverse md:grid md:grid-cols-2 md:grid-rows-1 md:gap-5 md:px-14 md:py-10">
    <div className=" border rounded-[2.5rem]">{children}</div>
    <br className="md:hidden" />
    <div className="w-full flex justify-center bg-[#0096E6] max-h-72 md:max-h-none rounded-[2.5rem] overflow-hidden">
      <img className="h-full" src={imgSrc} />
    </div>
  </div>
)

const WelcomePanel = ({ nextSlide }: { nextSlide: any }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={starterURL}>
    <div className="flex flex-col justify-around h-full text-left p-10 space-y-4 md:space-y-4">
      <div className="text-4xl font-bold">Welcome to Polycentric</div>
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

const InternetTodayPanel = ({ nextSlide }: { nextSlide: any }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={internetTodayURL}>
    <div className="flex flex-col p-10 gap-y-10">
      <div className="text-4xl font-bold">This is the internet today</div>
      <p className="text-xl">
        Two guys in California control every piece of content you see. If you hurt their feelings, you're out.
      </p>
      <p className="text-xl">
        Polycentric was developed with a love for the old internet, built around communities and respect for you.
      </p>
      <button
        className="bg-blue-500 text-white border shadow rounded-full md:rounded-md py-2 px-4 font-bold text-lg"
        onClick={nextSlide}
      >
        Let's go back
      </button>
    </div>
  </OnboardingPanel>
)

const GenCredsPanelItem = ({ title, hint }: { title: string; hint: string }) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <input type="text" className="rounded-lg border text-xl p-3" />
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
)

const GenCredsPanel = ({ nextSlide }: { nextSlide: any }) => (
  <OnboardingPanel nextSlide={nextSlide} imgSrc={internetTodayURL}>
    <div className="flex flex-col p-10 gap-y-5">
      <GenCredsPanelItem title="What's your username?" hint="You can change this later" />
      <GenCredsPanelItem title="What's your twitter app @? (optional)" hint="So people can find you." />
      <GenCredsPanelItem title="This is your password. Save it now." />
      <button className="bg-blue-500 text-white border shadow rounded-full md:rounded-md py-2 px-4 font-bold text-lg">
        Let's go
      </button>
    </div>
  </OnboardingPanel>
)

export const Onboarding = () => <Carousel childComponents={[WelcomePanel, InternetTodayPanel, GenCredsPanel]} />
