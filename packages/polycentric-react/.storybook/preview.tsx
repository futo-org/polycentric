import { IonApp, setupIonicReact } from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import type { Preview } from '@storybook/react'
import React from 'react'

import 'unfonts.css'
import '../src/lib/style/tailwind.css'
import '../src/lib/style/ionic.css'

setupIonicReact({
  mode: 'ios',
})

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
  // So that we can use react-router-dom's Link component in our stories
  decorators: [
    (Story) => (
      <IonApp>
        <IonReactRouter>
          <Story />
        </IonReactRouter>
      </IonApp>
    ),
  ],
}

export default preview
