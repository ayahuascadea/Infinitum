import os
import asyncio
import hashlib
import hmac
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import requests
import time
from concurrent.futures import ThreadPoolExecutor
import json
import uuid
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Bitcoin/Crypto imports
import binascii
import base58
import secp256k1
from mnemonic import Mnemonic

ROOT_DIR = os.path.dirname(__file__)
load_dotenv(os.path.join(ROOT_DIR, '.env'))

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(MONGO_URL)
db = client.btc_recovery

# BIP39 word list
mnemo = Mnemonic("english")
BIP39_WORDS = mnemo.wordlist

class RecoverySession(BaseModel):
    session_id: str
    known_words: Dict[str, str] = {}  # position: word (string keys for MongoDB compatibility)
    min_balance: float = 0.00000001  # Changed: Now searches for any amount > 0
    address_formats: List[str] = ["legacy", "segwit", "native_segwit"]
    max_combinations: int = 100000  # Safety limit
    status: str = "pending"

class RecoveryResult(BaseModel):
    session_id: str
    mnemonic: str
    addresses: Dict[str, str]
    balances: Dict[str, float]
    total_balance: float

# Blockchain API functions
def get_address_balance(address: str) -> float:
    """Get balance for a Bitcoin address using blockchain.info API"""
    try:
        response = requests.get(f"https://blockchain.info/rawaddr/{address}", timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data.get('final_balance', 0) / 100000000  # Convert satoshi to BTC
    except Exception as e:
        print(f"Error checking balance for {address}: {e}")
    return 0.0

def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """Convert mnemonic to seed using PBKDF2"""
    mnemonic_bytes = mnemonic.encode('utf-8')
    salt = ('mnemonic' + passphrase).encode('utf-8')
    return hashlib.pbkdf2_hmac('sha512', mnemonic_bytes, salt, 2048)

def seed_to_master_key(seed: bytes) -> bytes:
    """Derive master private key from seed"""
    return hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()

def derive_private_key(master_key: bytes, path: str = "m/44'/0'/0'/0/0") -> bytes:
    """Simple derivation for demonstration - in production use proper BIP32"""
    # This is simplified - real implementation would follow BIP32 exactly
    key_data = master_key[:32]
    for i in range(5):  # Simulate derivation steps
        key_data = hashlib.sha256(key_data + i.to_bytes(4, 'big')).digest()
    return key_data

def private_key_to_addresses(private_key: bytes) -> Dict[str, str]:
    """Generate different address formats from private key"""
    # Get public key
    sk = secp256k1.PrivateKey(private_key)
    public_key = sk.pubkey.serialize(compressed=True)
    addresses = {}

    # Legacy address (P2PKH)
    try:
        hash160 = hashlib.new('ripemd160', hashlib.sha256(public_key).digest()).digest()
        legacy_payload = b'\x00' + hash160
        checksum = hashlib.sha256(hashlib.sha256(legacy_payload).digest()).digest()[:4]
        addresses['legacy'] = base58.b58encode(legacy_payload + checksum).decode()
    except Exception as e:
        print(f"Error generating legacy address: {e}")

    # SegWit address (P2SH-P2WPKH) - simplified
    try:
        hash160 = hashlib.new('ripemd160', hashlib.sha256(public_key).digest()).digest()
        script = b'\x00\x14' + hash160
        script_hash = hashlib.new('ripemd160', hashlib.sha256(script).digest()).digest()
        segwit_payload = b'\x05' + script_hash
        checksum = hashlib.sha256(hashlib.sha256(segwit_payload).digest()).digest()[:4]
        addresses['segwit'] = base58.b58encode(segwit_payload + checksum).decode()
    except Exception as e:
        print(f"Error generating segwit address: {e}")

    # Native SegWit (Bech32) - placeholder for now
    addresses['native_segwit'] = f"bc1q{hash160.hex()[:20]}"  # Simplified

    return addresses

def check_mnemonic_validity(words: List[str]) -> bool:
    """Check if word combination is valid BIP39 mnemonic"""
    try:
        mnemonic_str = ' '.join(words)
        return mnemo.check(mnemonic_str)
    except:
        return False

def generate_word_combinations(known_words: Dict[str, str], max_combinations: int):
    """Generate word combinations based on known words"""
    # Convert string keys to integers for processing
    known_words_int = {int(k): v for k, v in known_words.items()}
    unknown_positions = [i for i in range(12) if i not in known_words_int]
    
    if len(unknown_positions) > 8:  # Too many unknowns
        print(f"Warning: {len(unknown_positions)} unknown positions - this will take very long")
    
    combinations_checked = 0
    
    def recursive_generate(current_combo, pos_index):
        nonlocal combinations_checked
        if combinations_checked >= max_combinations:
            return
            
        if pos_index >= len(unknown_positions):
            # Complete combination
            full_combo = [''] * 12
            # Fill in known words
            for pos, word in known_words_int.items():
                full_combo[pos] = word
            # Fill in current combination
            for i, pos in enumerate(unknown_positions):
                full_combo[pos] = current_combo[i]
            
            combinations_checked += 1
            yield full_combo
            return
        
        # Try each word for current position
        for word in BIP39_WORDS:
            if combinations_checked >= max_combinations:
                return
            yield from recursive_generate(current_combo + [word], pos_index + 1)
    
    yield from recursive_generate([], 0)

@app.post("/api/start-recovery")
async def start_recovery(session: RecoverySession):
    """Start a new recovery session"""
    try:
        session.session_id = str(uuid.uuid4())
        session.status = "running"
        
        # Store session in database
        await db.sessions.insert_one(session.dict())
        
        # Start background recovery task
        asyncio.create_task(perform_recovery(session))
        
        return {"session_id": session.session_id, "status": "started"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def perform_recovery(session: RecoverySession):
    """Perform the actual recovery process - IMPROVED to find ALL wallets with BTC"""
    try:
        found_wallets = []
        combinations_checked = 0
        
        # Update session status
        await db.sessions.update_one(
            {"session_id": session.session_id},
            {"$set": {"status": "running", "combinations_checked": 0}}
        )
        
        # Generate and test combinations
        for word_combo in generate_word_combinations(session.known_words, session.max_combinations):
            combinations_checked += 1
            
            # Check if valid BIP39
            if not check_mnemonic_validity(word_combo):
                continue
            
            mnemonic_str = ' '.join(word_combo)
            
            try:
                # Generate addresses
                seed = mnemonic_to_seed(mnemonic_str)
                master_key = seed_to_master_key(seed)
                private_key = derive_private_key(master_key)
                addresses = private_key_to_addresses(private_key)
                
                # Check balances
                balances = {}
                total_balance = 0
                
                for addr_type, address in addresses.items():
                    if addr_type in session.address_formats and address:
                        balance = get_address_balance(address) 
                        balances[addr_type] = balance
                        total_balance += balance
                
                # IMPROVED: Now finds ANY wallet with BTC > 0 (not just specific amounts)
                if total_balance > 0:  # Changed from >= session.target_balance to > 0
                    # Found a wallet with ANY BTC!
                    result = {
                        "session_id": session.session_id,
                        "mnemonic": mnemonic_str,
                        "addresses": addresses,
                        "balances": balances,
                        "total_balance": total_balance,
                        "found_at": combinations_checked
                    }
                    
                    await db.results.insert_one(result)
                    found_wallets.append(result)
                    print(f"FOUND WALLET: {mnemonic_str} - Balance: {total_balance} BTC")
                    
                    # IMPROVED: Continue searching instead of stopping
                    # (removed the break statement that was stopping the search)
                
                # Update progress every 100 combinations
                if combinations_checked % 100 == 0:
                    await db.sessions.update_one(
                        {"session_id": session.session_id},
                        {"$set": {
                            "combinations_checked": combinations_checked,
                            "found_wallets": len(found_wallets),
                            "last_updated": time.time()
                        }}
                    )
                
            except Exception as e:
                print(f"Error processing combination {combinations_checked}: {e}")
                continue
        
        # Mark session as completed
        await db.sessions.update_one(
            {"session_id": session.session_id},
            {"$set": {
                "status": "completed",
                "combinations_checked": combinations_checked,
                "found_wallets": len(found_wallets),
                "completed_at": time.time()
            }}
        )
        
    except Exception as e:
        print(f"Recovery error: {e}")
        await db.sessions.update_one(
            {"session_id": session.session_id},
            {"$set": {"status": "error", "error": str(e)}}
        )

@app.get("/api/session/{session_id}")
async def get_session_status(session_id: str):
    """Get status of a recovery session"""
    session = await db.sessions.find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Remove MongoDB _id for JSON serialization
    session.pop('_id', None)
    return session

@app.get("/api/results/{session_id}")
async def get_session_results(session_id: str):
    """Get results for a recovery session"""
    results = await db.results.find({"session_id": session_id}).to_list(100)
    
    # Remove MongoDB _id for JSON serialization
    for result in results:
        result.pop('_id', None)
    
    return {"results": results}

@app.get("/api/validate-word/{word}")
async def validate_bip39_word(word: str):
    """Check if a word is in BIP39 wordlist"""
    return {"valid": word.lower() in BIP39_WORDS, "word": word.lower()}

@app.get("/api/wordlist")
async def get_bip39_wordlist():
    """Get the full BIP39 word list"""
    return {"words": BIP39_WORDS[:100]}  # Return first 100 for demo

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "message": "BTC Recovery API is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)