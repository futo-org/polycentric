import { Menu } from '@headlessui/react'
import { useEffect } from 'react'

/* Because headless ui is stupid and Menu doesn't supply an onchange event, we must take its open prop, pass it to an interior component, and use useEffect there */
const CircleExpandMenuInterior = ({
  open,
  onIsOpenChange,
  title,
}: {
  open: boolean
  onIsOpenChange?: (isOpen: boolean) => void
  title?: string
}) => {
  useEffect(() => {
    onIsOpenChange?.(open)
  }, [open, onIsOpenChange])

  return (
    <div className={`absolute rounded-[1.5rem] border top-0 right-0 bg-white ${open ? 'z-10' : ''} overflow-hidden`}>
      <div className={`flex justify-between items-center w-full ${open ? 'rounded-br-[1.5rem] border-b' : ''}`}>
        {open && <h3 className="font-medium pl-5">{title}</h3>}

        <Menu.Button
          className={`h-[3rem] float-right rounded-full w-auto aspect-square flex justify-center items-center space-x-1 ${
            open ? 'bg-gray-100' : ''
          }`}
          onClick={() => {
            const newopen = !open
            if (onIsOpenChange) onIsOpenChange(newopen)
          }}
        >
          {(open ? [2, 2, 2] : [3, 3, 3]).map(() => (
            <div className="w-1 h-1 rounded-full bg-gray-500"></div>
          ))}
        </Menu.Button>
      </div>
      <Menu.Items as="div">
        <div className="w-[15rem]">
          <Menu.Item>
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-50 w-full">Switch To</button>
          </Menu.Item>
          <Menu.Item>
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-50 w-full">Sign Out</button>
          </Menu.Item>
        </div>
      </Menu.Items>
    </div>
  )
}

const CircleExpandMenuInteriorReverse = ({
  open,
  onIsOpenChange,
  title,
}: {
  open: boolean
  onIsOpenChange?: (isOpen: boolean) => void
  title?: string
}) => {
  useEffect(() => {
    onIsOpenChange?.(open)
  }, [open, onIsOpenChange])

  return (
    <div className={`absolute rounded-[1.5rem] border bottom-0 right-0 bg-white ${open ? 'z-10' : ''} overflow-hidden`}>
      <Menu.Items as="div">
        <div className="w-[15rem]">
          <Menu.Item>
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-50 w-full">Switch To</button>
          </Menu.Item>
          <Menu.Item>
            <button className="h-[3rem] px-5 flex items-center hover:bg-gray-100 w-full">Sign Out</button>
          </Menu.Item>
        </div>
      </Menu.Items>
      <div className={`flex justify-between items-center w-full ${open ? 'rounded-tr-[1.5rem] border-t' : ''}`}>
        {open && <h3 className="font-medium pl-5">{title}</h3>}

        <Menu.Button
          className={`h-[3rem] float-right rounded-full w-auto aspect-square flex justify-center items-center space-x-1 hover:bg-gray-50 ${
            open ? 'bg-gray-100' : ''
          }`}
          onClick={() => {
            const newopen = !open
            if (onIsOpenChange) onIsOpenChange(newopen)
          }}
        >
          {(open ? [2, 2, 2] : [3, 3, 3]).map(() => (
            <div className="w-1 h-1 rounded-full bg-gray-500"></div>
          ))}
        </Menu.Button>
      </div>
    </div>
  )
}

// Because Headless UI doesn't support nested menus (stupid), here's a legacy version thay doesn't use their button component
export const CircleExpandMenu = ({
  title,
  onIsOpenChange,
}: {
  title?: string
  onIsOpenChange?: (isOpen: boolean) => void
}) => {
  return (
    <Menu as="div" className="relative">
      {/* Because headless ui is stupid and Menu doesn't supply an onchange event, we must take its open prop, pass it to an interior component, and use useEffect there */}
      {({ open }) => <CircleExpandMenuInterior title={title} open={open} onIsOpenChange={onIsOpenChange} />}
    </Menu>
  )
}

export const CircleExpandMenuReverse = ({
  title,
  onIsOpenChange,
}: {
  title?: string
  onIsOpenChange?: (isOpen: boolean) => void
}) => {
  return (
    <Menu as="div" className="relative">
      {/* Because headless ui is stupid and Menu doesn't supply an onchange event, we must take its open prop, pass it to an interior component, and use useEffect there */}
      {({ open }) => <CircleExpandMenuInteriorReverse title={title} open={open} onIsOpenChange={onIsOpenChange} />}
    </Menu>
  )
}
