import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { IonHeader, IonTitle } from '@ionic/react'

import { useIsMobile } from '../../../hooks/styleHooks'
import { Link } from '../../util/link'

export const Header = ({ children }: { children?: React.ReactNode }) => {
  const isMobile = useIsMobile()

  if (isMobile)
    return (
      <IonHeader className="bg-white px-4 border-b">
        <Link routerDirection="back" routerLink="/" className="p-1">
          <ChevronLeftIcon className="h-6 w-6" />
        </Link>
        <IonTitle>{children}</IonTitle>
      </IonHeader>
    )

  return <></>
}
