import { isPlatform } from '@ionic/react'

export const useIsMobile = () => isPlatform('desktop') === false
