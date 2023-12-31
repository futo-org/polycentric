import { useEffect, useRef, useState } from 'react';

import 'swiper/css';
import { Swiper, SwiperRef, SwiperSlide } from 'swiper/react';

const LeftArrow = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-8 h-8"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
        />
    </svg>
);

const RightArrow = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-8 h-8"
    >
        <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
        />
    </svg>
);

// Assumes that components will just modify application setting state so no direct state sharing is needed between components
// Takes in an array of component types that take in a nextSlide function

export const Carousel = ({
    childComponents,
    className,
    swiperClassName,
}: {
    childComponents: (({
        nextSlide,
    }: {
        nextSlide: () => void;
    }) => JSX.Element)[];
    className?: string;
    swiperClassName?: string;
}) => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [maxVisitedSlide, setMaxVisitedSlide] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);

    const swiper = useRef<SwiperRef>(null);

    useEffect(() => {
        if (isTransitioning) {
            swiper.current?.swiper.slideTo(currentSlide);
            setIsTransitioning(false);
        }
    }, [isTransitioning, currentSlide]);

    return (
        <div className={className}>
            <Swiper
                onSlideChange={(swiper) => {
                    setCurrentSlide(swiper.activeIndex);
                }}
                allowSlideNext={
                    currentSlide < maxVisitedSlide || isTransitioning
                }
                allowSlidePrev={currentSlide > 0 || isTransitioning}
                className={swiperClassName}
                ref={swiper}
            >
                {childComponents.map((Child, i) => (
                    <SwiperSlide key={i}>
                        <Child
                            nextSlide={() => {
                                if (currentSlide < childComponents.length - 1) {
                                    setCurrentSlide(currentSlide + 1);
                                    setIsTransitioning(true);
                                    setMaxVisitedSlide(
                                        Math.max(
                                            currentSlide + 1,
                                            maxVisitedSlide,
                                        ),
                                    );
                                }
                            }}
                        />
                    </SwiperSlide>
                ))}
            </Swiper>
            <div className="hidden md:flex w-full justify-between space-x-5">
                {currentSlide > 0 ? (
                    <button
                        className={`swiper-button-prev md:flex justify-self-end w-20 h-20 rounded-full bg-white border justify-center items-center`}
                        onClick={() => {
                            if (currentSlide > 0) {
                                setCurrentSlide(currentSlide - 1);
                                setIsTransitioning(true);
                            }
                        }}
                    >
                        <LeftArrow />
                    </button>
                ) : (
                    <div />
                )}
                {currentSlide < maxVisitedSlide ? (
                    <button
                        className={`swiper-button-next justify-self-end hidden md:flex w-20 h-20 rounded-full bg-white border justify-center items-center`}
                        onClick={() => {
                            if (currentSlide < childComponents.length - 1) {
                                setCurrentSlide(currentSlide + 1);
                                setIsTransitioning(true);
                                setMaxVisitedSlide(
                                    Math.max(currentSlide + 1, maxVisitedSlide),
                                );
                            }
                        }}
                    >
                        <RightArrow />
                    </button>
                ) : (
                    <div />
                )}
            </div>
        </div>
    );
};
