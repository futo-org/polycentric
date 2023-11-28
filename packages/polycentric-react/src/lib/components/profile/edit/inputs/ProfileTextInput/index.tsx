import { GrowingTextArea } from '../../../../util/input/GrowingTextArea'

export const ProfileTextInput = ({
  value,
  onChange,
  title,
  hint,
  autoComplete,
  readOnly = false,
}: {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  title: string
  hint?: string
  autoComplete?: string
  readOnly?: boolean
}) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <input
      type="text"
      className="rounded-full border text-lg py-2.5 px-4 h-[3.15rem]"
      autoComplete={autoComplete}
      readOnly={readOnly}
      value={value}
      onChange={onChange}
    />
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
)

export const ProfileTextArea = ({
  value,
  onChange,
  title,
  hint,
  autoComplete,
  readOnly = false,
}: {
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  title: string
  hint?: string
  autoComplete?: string
  readOnly?: boolean
}) => (
  <div className="flex flex-col gap-y-1">
    <h3 className="font-medium">{title}</h3>
    <div className="rounded-[1.575rem] border focus-within:border-gray-300 overflow-clip">
      <GrowingTextArea
        // 3.15rem / 2 = 1.575rem
        maxHeightPx={108}
        className="text-lg py-3 px-4 w-full h-full focus:outline-none"
        autoComplete={autoComplete}
        readOnly={readOnly}
        value={value}
        onChange={onChange}
      />
    </div>
    <p className="text-sm text-gray-700">{hint}</p>
  </div>
)
