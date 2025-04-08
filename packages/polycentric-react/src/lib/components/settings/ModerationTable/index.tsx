import { Switch } from '@headlessui/react';
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
      <div className="text-center font-light">{descriptions[value] ?? ''}</div>
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
            left: `calc(${((value - min) / (max - min)) * 100}% - 1.5rem)`,
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
      'Offensive content',
    ],
    default: 2,
  },
  {
    name: 'Explicit Content',
    tagName: 'sexual',
    description: [
      'No explicit content',
      'Mildly suggestive, factual or educational',
      'Moderate sexual content, non-graphic',
      'Explicit sexual content',
    ],
    default: 1,
  },
  {
    name: 'Violence',
    tagName: 'violence',
    description: [
      'Non-violent',
      'Mild violence, factual or contextual',
      'Moderate violence, some graphic content.',
      'Graphic violence',
    ],
    default: 1,
  },
];

export const ModerationTable = () => {
  const [levels, setLevels] = useState<Record<string, number> | undefined>(
    () => {
      try {
        const item = localStorage.getItem('polycentric-moderation-levels');
        if (!item || item === 'undefined') {
          return undefined;
        }
        return JSON.parse(item);
      } catch (error) {
        console.error('Error parsing moderation levels:', error);
        return undefined;
      }
    },
  );

  const [showModerationTags, setShowModerationTags] = useState<boolean>(() => {
    try {
      const item = localStorage.getItem('polycentric-show-moderation-tags');
      return item === 'true';
    } catch (error) {
      console.error('Error parsing moderation tags visibility:', error);
      return false;
    }
  });

  const {
    setModerationLevels,
    setShowModerationTags: setContextShowModerationTags,
  } = useModeration();

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

  useEffect(() => {
    localStorage.setItem(
      'polycentric-show-moderation-tags',
      showModerationTags.toString(),
    );
    setContextShowModerationTags(showModerationTags);
  }, [showModerationTags, setContextShowModerationTags]);

  return (
    <div className="flex flex-col space-y-3">
      <div className="border rounded-[2rem] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Show Moderation Tags on Posts</h3>
            <p className="text-sm text-gray-500">
              When enabled, posts will display their moderation level tags
            </p>
          </div>
          <Switch
            checked={showModerationTags}
            onChange={setShowModerationTags}
            className={`${
              showModerationTags ? 'bg-blue-600' : 'bg-gray-200'
            } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
          >
            <span
              className={`${
                showModerationTags ? 'translate-x-6' : 'translate-x-1'
              } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
            />
          </Switch>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-2 md:gap-10 border rounded-[2rem] p-6">
        {categories.map((category, index) => (
          <div key={category.tagName} className="contents">
            <h3>{category.name}</h3>
            <FancySlider
              value={levels?.[category.tagName] ?? category.default}
              setValue={setLevelFunctions[index]}
              max={3}
              descriptions={category.description}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
