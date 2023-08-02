import type { Meta, StoryObj } from '@storybook/react'
import { PureRePost } from '.'

export default {
  title: 'Feed/PureRePost',
  component: PureRePost,
  tags: ['feed'],
}

export const Default = {
  args: {
    main: {
      content: 'L + Ratio + 1',
      topic: '/tpot_dating',
      author: {
        name: 'John Doe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(),
    },
    sub: {
      subcontent: 'This is the subcontent of the post',
      subtopic: '/tpot_dating',
      subauthor: {
        name: 'John Foe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      subpublishedAt: new Date(new Date().getTime() - 5000),
      subContentLink: '#',
    },
  },
}

export const LongMainContent = {
  args: {
    main: {
      title: 'on Right to Repair',
      content: `On Right To Repair 
        
        Right to repair has a fine handle on what is being advocated for, and it is spelled out in the legislation. I don't think people read it though. In the EU, it is different than in the US. I do not support legislation that forces design choices on modularity or using specific ports. That's EU Right to Repair, but I have no business on that since I don't live there. What I do support is the US Right to Repair, which gives you the rights to repair you device within 3 years (sometimes 5 depending on the state), access to diagnostic tools, repair diagrams and schematics, and supply of service parts. This is a right that everyone should enjoy. Our right to fix our own electronics is an old right of the people and it's important that we have the ability to do so. What I think needs to happen in the legislation though, is that device makers take more of a responsibility. What needs to start happening is that device makers need to take on more accountability and responsibility when it comes to how long their products last and how easy/difficult it is to repair them. It should not be okay for companies to design products to become less useful with age. That's just not in the best interest of the customer. I think that legislation should also be passed that requires device makers to offer easily accessible, accurate, and cost competitive repair service options. That means that it should be easy for consumers to find information about repairs, and they should be able to obtain parts and services in a timely manner at a reasonable price. It should also be illegal for device makers to create firmware that blocks the use of third party parts. I think if these changes were implemented, it would be a major step forward for consumer protection and it would allow patients to continue having access to their favorite devices for longer periods of time.`,
      topic: '/technology.repair',
      author: {
        name: 'Louis Rossmann',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(),
    },
    sub: {
      subcontent: 'L + Ratio + 1',
      subtopic: '/tpot_dating',
      subauthor: {
        name: 'John Doe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      subpublishedAt: new Date(new Date().getTime() - 5000),
      subContentLink: '#',
    },
  },
}

export const LongSubContent = {
  args: {
    main: {
      title: 'Reply on Right to Repair',
      content: 'L + Ratio + 1',
      topic: '/tpot_dating',
      author: {
        name: 'John Doe',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(),
    },
    sub: {
      subcontent: `As an electronics enthusiast, I totally agree with your points on Right to Repair. I have witnessed and experienced the frustrations of trying to fix my own devices. It's disheartening when you realize the device is designed in a way that discourages or even prevents repair, and pushes you to purchase a new one instead. This not only feels like an invasion of our rights as consumers but is also a significant contributor to the growing electronic waste problem. I believe having the right to repair our devices, coupled with the availability of resources such as schematics and genuine parts, will promote a culture of sustainability and extend the lifespan of our devices. It's high time manufacturers took responsibility for the full life cycle of their products, and that includes making them repairable.`,
      subtopic: '/technology.repair',
      subauthor: {
        name: 'Jane Smith',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      subpublishedAt: new Date(new Date().getTime() - 5000),
      subContentLink: '#',
    },
  },
}

export const LongMainSubContent = {
  args: {
    sub: {
      subtitle: 'My Breakthrough on Room-Temperature Superconductors',
      subcontent: `I believe I have made a groundbreaking discovery in the realm of materials science. After years of painstaking research, I have finally developed a superconductor that operates at room temperature. 
  
          It's an intricate compound composed of assorted rare-earth elements that, when exposed to a specific blend of magnetic and electric fields, demonstrates the phenomenon of superconductivity without the need for extreme cooling. This could revolutionize many fields - from power distribution to transportation and even computing.
  
          As we all know, one of the primary challenges in the superconductor field has been maintaining that state at room temperature, which has been a barrier to many of the potential applications of these materials. My invention could be the key to breaking down that barrier.
  
          I understand the skepticism that often surrounds claims like these and I welcome it. Rigorous scrutiny is what separates science from conjecture. I'm currently preparing my findings for peer review and am excited to share my research with the world.      
      `,
      subtopic: '/superconductor',
      subauthor: {
        name: 'Dr. Smith',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      subpublishedAt: new Date(),
    },
    main: {
      content: `
          Dr. Smith, while I appreciate your enthusiasm, I must question your claims until I see tangible evidence. As you well know, room-temperature superconductivity is the holy grail of materials science and has remained elusive for a reason. 
  
          You have not specified your method of measuring superconductivity or even given us a glimpse into the actual materials used in your supposed breakthrough. These details are essential before any kind of scientific discussion can take place. 
  
          Furthermore, I am concerned about your mention of "assorted rare-earth elements". The over-reliance on rare earths can pose both an environmental and geopolitical problem considering their scarcity and the potential for exploitation. 
  
          As a scientist, it is your responsibility to ensure that your claims are backed by substantial, peer-reviewed evidence before announcing them to the public. In the absence of this, it is hard for me or anyone in the scientific community to take your statements at face value. I look forward to reviewing your research once it's made available.
      `,
      topic: '/superconductor',
      author: {
        name: 'Professor Johnson',
        avatarURL: 'https://i.pravatar.cc/300',
      },
      publishedAt: new Date(new Date().getTime() - 5000),
      subContentLink: '#',
    },
  },
}
