import { Carousel } from '.';

export default {
  title: 'Util/Slideshow',
  component: Carousel,
};

const Foo = ({ nextSlide }: { nextSlide: () => void }) => (
  <div onClick={nextSlide}>Slide 1</div>
);

const Bar = () => <div>slide 2</div>;

export const Default = {
  args: {
    className: 'w-96',
    swiperClassName: 'w-96 h-96',
    childComponents: [Foo, Bar],
  },
};
