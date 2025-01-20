import { useState } from 'react';

export interface ClaimData {
    type: 'social' | 'occupation' | 'skill' | 'freeform';
    data: string | { organization: string; role: string; location: string };
}

export const ClaimTypePopup = ({ onClose, onSelect }: { 
    onClose: () => void, 
    onSelect: (type: ClaimData['type']) => void 
}) => {
    return (
        <div className="absolute bottom-14 left-0 bg-white border rounded-lg shadow-lg p-2 z-50">
            <div className="flex flex-col gap-2">
                <button 
                    onClick={() => onSelect('social')} 
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Social Media
                </button>
                <button 
                    onClick={() => onSelect('occupation')} 
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Occupation
                </button>
                <button 
                    onClick={() => onSelect('skill')} 
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Skill
                </button>
                <button 
                    onClick={() => onSelect('freeform')} 
                    className="text-left px-4 py-2 hover:bg-gray-100 rounded-md"
                >
                    Freeform
                </button>
            </div>
        </div>
    );
};

export const SocialMediaInput = ({ onSubmit, onCancel }: {
    onSubmit: (url: string) => void,
    onCancel: () => void
}) => {
    const [url, setUrl] = useState('');
    
    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add Social Media Profile</h2>
                <input
                    type="url"
                    placeholder="Paste your profile URL"
                    className="border p-2 rounded-lg"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={() => onSubmit(url)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
};

export const OccupationInput = ({ onSubmit, onCancel }: {
    onSubmit: (data: { organization: string, role: string, location: string }) => void,
    onCancel: () => void
}) => {
    const [organization, setOrganization] = useState('');
    const [role, setRole] = useState('');
    const [location, setLocation] = useState('');
    
    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add Occupation</h2>
                <input
                    type="text"
                    placeholder="Organization"
                    className="border p-2 rounded-lg"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Role"
                    className="border p-2 rounded-lg"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Location"
                    className="border p-2 rounded-lg"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={() => onSubmit({ organization, role, location })}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
};

export const TextInput = ({ title, onSubmit, onCancel }: {
    title: string,
    onSubmit: (text: string) => void,
    onCancel: () => void
}) => {
    const [text, setText] = useState('');
    
    return (
        <div className="absolute inset-0 bg-white p-4 z-50">
            <div className="flex flex-col gap-4">
                <h2 className="text-xl font-semibold">Add {title}</h2>
                <input
                    type="text"
                    placeholder={`Enter ${title.toLowerCase()}`}
                    className="border p-2 rounded-lg"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={() => onSubmit(text)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>
    );
};