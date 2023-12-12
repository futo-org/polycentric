import { ReactNode } from 'react'
import { useIsMobile } from '../../../hooks/styleHooks'
import { SearchBox } from '../../search/searchbox'

export const RightCol = ({
  children,
  leftCol,
  desktopTitle,
}: {
  leftCol: ReactNode
  children: ReactNode
  desktopTitle?: string
}) => {
  const isMobile = useIsMobile()
  return (
    <div className="h-full overflow-auto flex noscrollbar">
      <div className="w-full lg:w-[700px] xl:w-[776px] relative">
        {desktopTitle && <h1 className="p-10 border-b text-xl font-lg">{desktopTitle}</h1>}
        {children}
      </div>
      {isMobile ? (
        <div />
      ) : (
        <div className="h-full sticky top-0 border-x hidden xl:block xl:w-[calc((100vw-776px)/2)] 2xl:w-[calc((1536px-776px)/2)] 2xl:mr-[calc((100vw-1536px)/2)] ">
          <div className="p-5 pb-10">
            <SearchBox />
          </div>
          {leftCol}
        </div>
      )}
    </div>
  )
}
