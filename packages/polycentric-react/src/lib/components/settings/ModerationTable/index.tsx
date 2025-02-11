import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useModeration } from '../../../hooks/moderationHooks';

const FancySlider = ({
    min = 0,
    max,
    descriptions,
    value,
    setValue,
}: {
    min?: number;
    max: number;
    descriptions: Array<string>;
    value: number;
    setValue: Dispatch<SetStateAction<number>>;
}) => {
    return (
        <div className="pl-10 md:pl-0 pr-2 md:pr-0 w-full max-w-md mx-auto">
            <div className="text-center font-light">
                {descriptions[value] ?? ''}
            </div>
            <div className="relative w-full h-12">
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    step="1"
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer absolute top-1/2 transform -translate-y-1/2"
                    style={{
                        WebkitAppearance: 'none',
                        appearance: 'none',
                    }}
                />
                <div
                    className="absolute top-1/2 w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg pointer-events-none"
                    style={{
                        left: `calc(${
                            ((value - min) / (max - min)) * 100
                        }% - 1.5rem)`,
                        transform: 'translateY(-50%)',
                        transition: 'left 0.1s ease-out',
                    }}
                >
                    {value}
                </div>
            </div>
        </div>
    );
};

const categories = [
    {
        name: 'Offensive Content',
        tagName: 'hate',
        description: [
            'Neutral, general terms, no bias or hate.',
            'Mildly sensitive, factual.',
            'Potentially offensive content',
        ],
    },
    {
        name: 'Explicit Content',
        tagName: 'sex',
        description: [
            'No explicit content',
            'Mildly suggestive, factual or educational',
            'Moderate sexual content, non-graphic',
        ],
    },
    {
        name: 'Violence',
        tagName: 'violence',
        description: [
            'Non-violent',
            'Mild violence, factual or contextual',
            'Moderate violence, some graphic content.',
        ],
    },
];

export const ModerationTable = () => {
    const [levels, setLevels] = useState<Record<string, number>>(
        JSON.parse(
            localStorage.getItem('polycentric-moderation-levels') ?? '{}',
        ),
    );
    const { setModerationLevels } = useModeration();

    const setLevelFunctions = useMemo(() => {
        return categories.map((category) => {
            return (level: React.SetStateAction<number>) => {
                setLevels((prev) => ({
                    ...prev,
                    [category.tagName]: level as number,
                }));
            };
        });
    }, []);

    useEffect(() => {
        localStorage.setItem(
            'polycentric-moderation-levels',
            JSON.stringify(levels),
        );
        setModerationLevels(levels);
    }, [levels, setModerationLevels]);

    return (
        <div className="flex flex-col space-y-3">
            <h2 className="font-medium">Moderation Settings</h2>

            <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-2 md:gap-10 border rounded-[2rem] p-6">
                {categories.map((category, index) => (
                    <div key={category.tagName} className="contents">
                        <h3>{category.name}</h3>
                        <FancySlider
                            value={levels[category.tagName] ?? 0}
                            setValue={setLevelFunctions[index]}
                            max={2}
                            descriptions={category.description}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
