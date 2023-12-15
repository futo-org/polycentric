import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { IonHeader, IonTitle } from '@ionic/react'

import { useIsMobile } from '../../../hooks/styleHooks'
import { Link } from '../../util/link'

export const Header = ({ children, hasBack = true }: { children?: React.ReactNode; hasBack?: boolean }) => {
  const isMobile = useIsMobile()

  if (isMobile)
    return (
      <IonHeader className="bg-white px-4 border-b">
        {hasBack ? (
          <Link routerDirection="back" routerLink="/" className="p-1">
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
        ) : (
          <div className="w-6 h-6 m-1" />
        )}
        <IonTitle>{children}</IonTitle>
      </IonHeader>
    )

  return <></>
}
