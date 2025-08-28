import { IonContent } from '@ionic/react';
import * as Core from '@polycentric/polycentric-core';
import { useState } from 'react';
import { Page } from '../../app/routes';
import { Header } from '../../components/layout/header';
import { RightCol } from '../../components/layout/rightcol';
import { DMChatComponent } from '../../dm/DMChatComponent';
import Long from 'long';

export const DMPage: Page = () => {
  const [selectedContact, setSelectedContact] = useState<{
    publicKey: Core.Models.PublicKey.PublicKey;
    name?: string;
  } | null>(null);
  const [publicKeyInput, setPublicKeyInput] = useState('');

  const handleStartConversation = () => {
    if (!publicKeyInput.trim()) return;
    
    try {
      let publicKey: Core.Models.PublicKey.PublicKey;
      const input = publicKeyInput.trim();
      
      try {
        // First try parsing as a full PublicKey string (protobuf format)
        publicKey = Core.Models.PublicKey.fromString(
          input as Core.Models.PublicKey.PublicKeyString
        );
      } catch {
        // If that fails, assume it's raw Ed25519 key bytes in base64
        const keyBytesBase64 = input.replace(/[^A-Za-z0-9+/=]/g, ''); // Clean input
        const binaryString = atob(keyBytesBase64);
        const keyBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          keyBytes[i] = binaryString.charCodeAt(i);
        }
        
        if (keyBytes.length !== 32) {
          throw new Error('Ed25519 public key must be 32 bytes');
        }
        
        // Create PublicKey with Ed25519 key type (1)
        publicKey = Core.Models.PublicKey.fromProto({
          keyType: Long.fromNumber(1), // Ed25519 key type
          key: keyBytes,
        });
      }
      
      setSelectedContact({
        publicKey,
        name: input, // Use the input as name for now
      });
      setPublicKeyInput('');
    } catch (error) {
      console.error('Invalid public key:', error);
      alert('Invalid public key format. Please provide either a full PublicKey string or raw Ed25519 key bytes in base64.');
    }
  };

  const renderStartConversation = () => (
    <div className="flex flex-col items-center justify-center h-full p-8 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-gray-900">Start a Conversation</h2>
        <p className="text-gray-600">
          Enter a public key to start a direct message conversation
        </p>
      </div>
      
      <div className="w-full max-w-md space-y-4">
        <div className="space-y-2">
          <label htmlFor="publicKey" className="block text-sm font-medium text-gray-700">
            Public Key
          </label>
          <input
            id="publicKey"
            type="text"
            value={publicKeyInput}
            onChange={(e) => setPublicKeyInput(e.target.value)}
            placeholder="Enter public key..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        <button
          onClick={handleStartConversation}
          disabled={!publicKeyInput.trim()}
          className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Start Conversation
        </button>
      </div>
      
      {selectedContact && (
        <div className="mt-4 p-4 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600">
            Previous conversation started with: {selectedContact.name}
          </p>
          <button
            onClick={() => setSelectedContact(null)}
            className="mt-2 text-blue-500 text-sm hover:text-blue-600"
          >
            Start a new conversation
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Header canHaveBackButton={false}>Direct Messages</Header>
      <IonContent>
        <RightCol rightCol={<div />} desktopTitle="Direct Messages">
          <div className="h-full">
            {selectedContact ? (
              <div className="h-full flex flex-col">
                <div className="border-b p-4 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-900">
                      {selectedContact.name || 'Direct Message'}
                    </h3>
                    <button
                      onClick={() => setSelectedContact(null)}
                      className="text-gray-500 hover:text-gray-700 text-sm"
                    >
                      Back to contacts
                    </button>
                  </div>
                </div>
                <div className="flex-1">
                  <DMChatComponent 
                    otherParty={selectedContact.publicKey}
                    otherPartyName={selectedContact.name}
                  />
                </div>
              </div>
            ) : (
              renderStartConversation()
            )}
          </div>
        </RightCol>
      </IonContent>
    </>
  );
};
