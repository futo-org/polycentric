import { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { GrowingTextArea } from '../../../../util/input/GrowingTextArea';

export const ProfileTextInput = ({
  title,
  hint,
  maxLength,
  ...rest
}: {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  title: string;
  hint?: string;
  autoComplete?: string;
  readOnly?: boolean;
  maxLength?: number;
} & InputHTMLAttributes<HTMLInputElement>) => {
  const currentLength = rest.value?.toString().length || 0;
  const showCounter = maxLength !== undefined;

  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">{title}</h3>
        {showCounter && (
          <span
            className={`text-xs ${
              currentLength >= maxLength ? 'text-red-500' : 'text-gray-500'
            }`}
          >
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
      <input
        type="text"
        className="rounded-full border text-lg py-2.5 px-4 h-[3.15rem]"
        maxLength={maxLength}
        {...rest}
      />
      <p className="text-sm text-gray-700">{hint}</p>
    </div>
  );
};

export const ProfileTextArea = ({
  title,
  hint,
  maxLength,
  ...rest
}: {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  title: string;
  hint?: string;
  maxLength?: number;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const currentLength = rest.value?.toString().length || 0;
  const showCounter = maxLength !== undefined;

  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">{title}</h3>
        {showCounter && (
          <span
            className={`text-xs ${
              currentLength >= maxLength ? 'text-red-500' : 'text-gray-500'
            }`}
          >
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
      <div className="rounded-[1.575rem] border focus-within:border-gray-300 overflow-clip">
        <GrowingTextArea
          // 3.15rem / 2 = 1.575rem
          maxHeightPx={108}
          className="text-lg py-3 px-4 w-full h-full focus:outline-none"
          maxLength={maxLength}
          {...rest}
        />
      </div>
      <p className="text-sm text-gray-700">{hint}</p>
    </div>
  );
};
