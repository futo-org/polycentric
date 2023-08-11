import React from 'react'
import { Carousel } from '.'

export default {
  title: 'Util/Slideshow',
  component: Carousel,
}

const Foo = ({ nextSlide }) => (
  <div className="bg-red-500" onClick={nextSlide}>
    Slide 1
  </div>
)
const Bar = () => <div className="bg-red-500">Slide2 </div>

export const Default = {
  args: {
    childComponents: [Foo, Bar],
  },
}
