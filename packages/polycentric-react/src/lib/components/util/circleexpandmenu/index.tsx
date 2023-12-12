import { Menu } from '@headlessui/react'
import { useEffect } from 'react'
import { Link } from '../link'

/* Because headless ui is stupid and Menu doesn't supply an onchange event, we must take its open prop, pass it to an interior component, and use useEffect there */

const CircleExpandMenuInteriorReverse = ({
  open,
  onIsOpenChange,
  title,
  menuItems,
}: {
  open: boolean
  onIsOpenChange?: (isOpen: boolean) => void
  title?: string
  menuItems: { label: string; action?: () => void; routerLink?: string }[]
}) => {
  useEffect(() => {
    onIsOpenChange?.(open)
  }, [open, onIsOpenChange])

  return (
    <div className={`absolute rounded-[1.5rem] border bottom-0 right-0 bg-white ${open ? 'z-10' : ''} overflow-hidden`}>
      <Menu.Items as="div">
        <div className="w-[15rem]">
          {menuItems.map((item, index) => (
            <Menu.Item key={index}>
              {item.routerLink ? (
                <Link
                  routerLink={item.routerLink}
                  className={`h-[3rem] px-5 flex items-center text-black hover:bg-gray-${
                    index % 2 === 0 ? '50' : '100'
                  } w-full`}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  className={`h-[3rem] px-5 flex items-center hover:bg-gray-${index % 2 === 0 ? '50' : '100'} w-full`}
                  onClick={item.action}
                >
                  {item.label}
                </button>
              )}
            </Menu.Item>
          ))}
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
          <div className="w-1 h-1 rounded-full bg-gray-500"></div>
          <div className="w-1 h-1 rounded-full bg-gray-500"></div>
          <div className="w-1 h-1 rounded-full bg-gray-500"></div>
        </Menu.Button>
      </div>
    </div>
  )
}

export const CircleExpandMenuReverse = ({
  title,
  onIsOpenChange,
  menuItems,
}: {
  title?: string
  onIsOpenChange?: (isOpen: boolean) => void
  menuItems: { label: string; action?: () => void; routerLink?: string }[]
}) => {
  return (
    <Menu as="div" className="relative">
      {/* Because headless ui is stupid and Menu doesn't supply an onchange event, we must take its open prop, pass it to an interior component, and use useEffect there */}
      {({ open }) => (
        <CircleExpandMenuInteriorReverse
          menuItems={menuItems}
          title={title}
          open={open}
          onIsOpenChange={onIsOpenChange}
        />
      )}
    </Menu>
  )
}
