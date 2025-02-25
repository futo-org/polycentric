import { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { GrowingTextArea } from '../../../../util/input/GrowingTextArea';

export const ProfileTextInput = ({
  title,
  hint,
  ...rest
}: {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  title: string;
  hint?: string;
  autoComplete?: string;
  readOnly?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <input
      type="text"
      className="rounded-full border text-lg py-2.5 px-4 h-[3.15rem]"
      {...rest}
    />
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
);

export const ProfileTextArea = ({
  title,
  hint,
  ...rest
}: {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  title: string;
  hint?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <div className="rounded-[1.575rem] border focus-within:border-gray-300 overflow-clip">
      <GrowingTextArea
        // 3.15rem / 2 = 1.575rem
        maxHeightPx={108}
        className="text-lg py-3 px-4 w-full h-full focus:outline-none"
        {...rest}
      />
    </div>
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
);
