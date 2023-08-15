// All this is is a feed and then in the third column something customizable via child

import { DummyScrollFeed } from '../DummyScrollFeed'

export const FeedPage = () => {
  return (
    <div className="flex flex-row">
      <div className="w-2/3">
        {/* <DummyScrollFeed
          p={[
            {
              content: 'This is the content of the post',
              topic: '/tpot_dating',
              author: {
                name: 'John Doe',
                avatarURL: 'https://i.pravatar.cc/300',
              },
              publishedAt: new Date(),
            },
            {
              content: `On Right To Repair 
        
        Right to repair has a fine handle on what is being advocated for, and it is spelled out in the legislation. I don't think people read it though. In the EU, it is different than in the US. I do not support legislation that forces design choices on modularity or using specific ports. That's EU Right to Repair, but I have no business on that since I don't live there. What I do support is the US Right to Repair, which gives you the rights to repair you device within 3 years (sometimes 5 depending on the state), access to diagnostic tools, repair diagrams and schematics, and supply of service parts. This is a right that everyone should enjoy. Our right to fix our own electronics is an old right of the people and it's important that we have the ability to do so. What I think needs to happen in the legislation though, is that device makers take more of a responsibility. What needs to start happening is that device makers need to take on more accountability and responsibility when it comes to how long their products last and how easy/difficult it is to repair them. It should not be okay for companies to design products to become less useful with age. That's just not in the best interest of the customer. I think that legislation should also be passed that requires device makers to offer easily accessible, accurate, and cost competitive repair service options. That means that it should be easy for consumers to find information about repairs, and they should be able to obtain parts and services in a timely manner at a reasonable price. It should also be illegal for device makers to create firmware that blocks the use of third party parts. I think if these changes were implemented, it would be a major step forward for consumer protection and it would allow patients to continue having access to their favorite devices for longer periods of time.`,
              topic: '/technology.repair',
              author: {
                name: 'Louis Rossmann',
                avatarURL: 'https://i.pravatar.cc/300',
              },
              publishedAt: new Date(),
            },
          ]}
        /> */}
      </div>
      <div className="w-1/3">
        <p>hello</p>
      </div>
    </div>
  )
}
