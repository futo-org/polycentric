import React from 'react'
import { Carousel } from '.'
import starterURL from '../../../../graphics/onboarding/starter.svg'

export default {
  title: 'Util/Slideshow',
  component: Carousel,
}

const Foo = ({ nextSlide }: { nextSlide: any }) => (
  <div className="bg-red-500" onClick={nextSlide}>
    Slide 1
  </div>
)
const Bar = () => <img src={starterURL} />

export const Default = {
  args: {
    childComponents: [Foo, Bar],
  },
}
