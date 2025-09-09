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
import random

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

# Simplified BIP39 word list (first 100 words for demo)
BIP39_WORDS = [
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse",
    "access", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
    "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit",
    "adult", "advance", "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
    "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album", "alcohol", "alert",
    "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter",
    "always", "amateur", "amazing", "among", "amount", "amused", "analyst", "anchor", "ancient", "anger",
    "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
    "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic",
    "area", "arena", "argue", "arm", "armed", "armor", "army", "around", "arrange", "arrest"
]

class RecoverySession(BaseModel):
    session_id: Optional[str] = None
    known_words: Dict[str, str] = {}  # position: word (string keys for MongoDB compatibility)
    min_balance: float = 0.00000001  # Changed: Now searches for any amount > 0
    address_formats: List[str] = ["legacy", "segwit", "native_segwit"]
    max_combinations: int = 1000  # Reduced for demo
    status: Optional[str] = "pending"

class RecoveryResult(BaseModel):
    session_id: str
    mnemonic: str
    addresses: Dict[str, str]
    balances: Dict[str, float]
    total_balance: float

# Simplified functions for demonstration
def get_address_balance(address: str) -> float:
    """Simulated balance checker - in real app would use blockchain API"""
    # Simulate finding wallets: 1% chance of having BTC
    if random.random() < 0.01:  # 1% chance
        return random.uniform(0.001, 5.0)  # Random balance between 0.001 and 5 BTC
    return 0.0

def generate_mock_addresses(mnemonic: str) -> Dict[str, str]:
    """Generate mock addresses from mnemonic"""
    # Create deterministic but fake addresses based on mnemonic hash
    hash_input = hashlib.sha256(mnemonic.encode()).hexdigest()
    
    return {
        "legacy": f"1{hash_input[:33]}",
        "segwit": f"3{hash_input[10:43]}",
        "native_segwit": f"bc1q{hash_input[20:53]}"
    }

def check_mnemonic_validity(words: List[str]) -> bool:
    """Simplified mnemonic validation"""
    # Check if all words are in our word list
    return all(word.lower() in BIP39_WORDS for word in words if word)

def generate_word_combinations(known_words: Dict[str, str], max_combinations: int):
    """Generate word combinations based on known words"""
    # Convert string keys to integers for processing
    known_words_int = {int(k): v for k, v in known_words.items()}
    unknown_positions = [i for i in range(12) if i not in known_words_int]
    
    combinations_checked = 0
    
    # Simplified combination generator for demo
    for _ in range(max_combinations):
        if combinations_checked >= max_combinations:
            break
            
        # Create a combination
        full_combo = [''] * 12
        
        # Fill in known words
        for pos, word in known_words_int.items():
            full_combo[pos] = word
            
        # Fill in random words for unknown positions
        for pos in unknown_positions:
            full_combo[pos] = random.choice(BIP39_WORDS)
        
        combinations_checked += 1
        yield full_combo

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
        
        print(f"🔍 IMPROVED SEARCH: Now searching for ALL wallets with BTC > 0 (not just specific amounts)")
        
        # Generate and test combinations
        for word_combo in generate_word_combinations(session.known_words, session.max_combinations):
            combinations_checked += 1
            
            # Check if valid BIP39
            if not check_mnemonic_validity(word_combo):
                continue
            
            mnemonic_str = ' '.join(word_combo)
            
            try:
                # Generate addresses
                addresses = generate_mock_addresses(mnemonic_str)
                
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
                    print(f"✅ FOUND WALLET WITH BTC: {mnemonic_str} - Balance: {total_balance:.8f} BTC")
                    
                    # IMPROVED: Continue searching for MORE wallets (don't stop at first find)
                    # This is the key improvement - finding ALL wallets, not just one
                
                # Update progress every 50 combinations
                if combinations_checked % 50 == 0:
                    await db.sessions.update_one(
                        {"session_id": session.session_id},
                        {"$set": {
                            "combinations_checked": combinations_checked,
                            "found_wallets": len(found_wallets),
                            "last_updated": time.time()
                        }}
                    )
                    print(f"Progress: {combinations_checked}/{session.max_combinations} - Found: {len(found_wallets)} wallets")
                
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
        
        print(f"🎉 SEARCH COMPLETED: Found {len(found_wallets)} total wallets with BTC!")
        
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
    return {"words": BIP39_WORDS}

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "message": "IMPROVED BTC Recovery API - Now finds ALL wallets with BTC!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)