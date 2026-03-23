# Partner Device Account System

## Overview

The Partner Device Account System enables couples to use "Restart Our Love" on separate devices with synchronized encryption and data sharing. The system is designed around the concept of a "main account" (premium) and a "partner account" on a separate device.

---

## Architecture

### Account Types

1. **Main Account (Owner)**
   - Premium subscription required
   - Creates connection codes for partner devices
   - Owns all encryption keys
   - Can have personal and couple sessions
   - Role: 'user' or 'admin'

2. **Partner Account**
   - Created on separate device/login
   - Inherits encryption keys from main account (PIN salt/verifier)
   - Wipes all existing personal data during conversion
   - Gets role: 'partner'
   - Can participate in couple sessions only
   - Shares subscription tier with main account

### Key Concepts

- **Single Device vs. Own Device**: 
  - Single Device: Both accounts on same device via Firebase multi-device support
  - Own Device: Partner account on separate device/login (this feature)

- **Encryption Sharing**: 
  - Partner account inherits PIN salt/verifier from main account
  - Allows both accounts to encrypt/decrypt with same session key
  - No key exchange needed for session participation

---

## User Flows

### Flow 1: Create Partner Account During Registration

```
1. New User Registers
   └─> Email verified
   └─> PIN setup (first account)
   └─> ["Create my own account" | "Connect to partner's account"]
       ├─ "Create my own account"
       │  └─> Profile setup complete
       │  └─> User can later generate connection code
       │
       └─ "Connect to partner's account"
          └─> Input partner's connection code
          └─> Send phone/email to main account holder
          └─> Partner generates code
          └─> Enter code & verify
          └─> Account converted to partner type
          └─> All personal data wiped
          └─> PIN inherited from main account
          └─> Subscription inherited from main account
```

### Flow 2: Add Partner Account After Initial Setup

```
1. Existing User (Premium)
   └─> Settings → "Add Partner Device"
   └─> Generate Connection Code
   └─> Code displayed (6 chars, 24 hour expiration)
   └─> Share code with partner
   
2. Partner User (New or Existing)
   └─> During registration: Choose "Connect to partner's account"
   └─> OR in Settings: "Connect as Partner Device"
   └─> Input connection code
   └─> Account conversion:
       - Personal data wiped
       - PIN inherited
       - Subscription inherited
       - Role set to 'partner'
       - mainAccountUid set
       - accountType set to 'partner'
```

---

## API Endpoints

### 1. Generate Partner Connection Code

**Endpoint:** `POST /api/generate-partner-connection-code`

**Request:**
```json
{
  "mainAccountUid": "user_uid_here"
}
```

**Validation:**
- Main account must exist
- Main account must be premium tier
- Rate limit: 5 codes per hour per IP

**Response (Success):**
```json
{
  "code": "A1B2C3",
  "expiresAt": "2026-03-24T10:30:00Z",
  "message": "Share this code with your partner to connect their device"
}
```

**Response (Errors):**
- `400`: Invalid mainAccountUid
- `403`: Main account must be premium
- `429`: Too many codes generated
- `500`: Server error

**Audit Logging:**
- Action: `partner_connection_code_generated`
- Details: code, expiresAt

---

### 2. Connect as Partner Device

**Endpoint:** `POST /api/connect-as-partner-device`

**Request:**
```json
{
  "partnerAccountUid": "partner_user_uid",
  "connectionCode": "A1B2C3",
  "pinSalt": "base64_encoded_salt_from_main_account",
  "pinVerifier": "hash_from_main_account"
}
```

**Validation:**
- Connection code format (6 alphanumeric)
- Connection code exists and not expired
- Connection code not already used
- Main account exists and is premium
- PIN salt and verifier format valid

**Processing:**
1. Validate connection code
2. Retrieve main account profile
3. Verify main account is premium
4. Wipe partner account personal data
5. Update partner account:
   - Set `mainAccountUid`
   - Set `accountType` = 'partner'
   - Set `role` = 'partner'
   - Set `pinSalt` (from main account)
   - Set `pinVerifier` (from main account)
   - Set `subscriptionTier` (from main account)
   - Set `language` (from main account)
6. Mark code as used
7. Log audit events

**Response (Success):**
```json
{
  "success": true,
  "message": "Successfully connected as partner device account",
  "mainAccountUid": "main_user_uid"
}
```

**Response (Errors):**
- `400`: Invalid input parameters
- `404`: Connection code not found
- `404`: Main account not found
- `403`: Main account must be premium
- `409`: Connection code already used
- `410`: Connection code expired
- `500`: Server error

**Audit Logging:**
- Action: `partner_device_connected` (partner account)
- Action: `partner_device_link_confirmed` (main account)
- Details: IDs, code, connection info

---

## Data Model

### partnerConnectionCodes Collection

**Location:** `partnerConnectionCodes/{codeId}`

**Fields:**
```firestore
{
  mainAccountUid: string,        // UID of main (premium) account
  code: string,                  // 6-char alphanumeric code
  expiresAt: timestamp,          // 24 hours from creation
  createdAt: timestamp,          // Server timestamp
  used: boolean,                 // false until connection successful
  partnerAccountUid: string|null,// Set when code is used
  usedAt: timestamp|null         // Set when code is used
}
```

**Firestore Rules:**
- No client-side read/write
- Server API only reads/writes this collection
- Admins can delete codes

### Users Collection Updates

**New Fields for Partner Accounts:**
```firestore
{
  // Existing fields...
  
  // NEW: Partner Account Fields
  mainAccountUid?: string,       // Set for partner accounts
  accountType?: 'owner' | 'partner',
  
  // Role now includes 'partner'
  role?: 'user' | 'admin' | 'partner'
}
```

---

## Data Wipeout Process

When a partner account connects, all personal data is removed:

### Deleted Data Categories:

1. **Personal Sessions**
   - All personal sessions owned by partner account
   - All messages in personal sessions
   - All message summaries
   - Session metadata

2. **Timeline Entries**
   - All personal timeline entries owned by partner account

3. **Homework**
   - All homework assigned to partner account

### Preserved Data:

- **Couple Sessions**: Remain intact
  - Partner becomes participant in couple sessions
  - All couple session messages preserved

- **Encryption Keys**:
  - Exchange keys remain (for key derivation)
  - PIN derivation keys copied from main account

- **Profile Information**:
  - Email, displayName, photoURL remain
  - Profile encrypted fields can be preserved or updated

---

## Encryption Integration

### PIN/Key Derivation

Main Account:
```
PIN + Salt = KEK (Key Encryption Key)
KEK + CK = Wrapped Content Key
```

Partner Account (After Connection):
```
Same PIN (inherited) + Same Salt (inherited) = Same KEK
Allows decryption of shared content
```

### Session Encryption

For couple sessions after partner connection:
1. Couple session uses Relationship Key (RK) derived from exchange keys
2. Both accounts can use same RK for encryption/decryption
3. No re-encryption needed

---

## Frontend Integration (Upcoming UI Phase)

### 1. Registration Flow Update

```tsx
// After PIN setup, show:
<ChooseAccountType>
  <Button>Create My Own Account</Button>
  <Button>Connect to Partner's Account</Button>
</ChooseAccountType>
```

### 2. Settings: Add Partner Device

```tsx
// In Settings (Premium accounts only)
<Section>
  <Header>Partner Device</Header>
  <Button onClick={generateConnectionCode}>
    Generate Connection Code
  </Button>
  
  {code && (
    <CodeDisplay>
      Code: {code}
      Expires: {formattedTime}
      <Button onClick={copyToClipboard}>Copy</Button>
      <Button onClick={shareCode}>Share</Button>
    </CodeDisplay>
  )}
</Section>
```

### 3. Partner Connection Input

```tsx
// In Registration (when choosing "Connect to partner") or Settings
<PartnerConnectionForm>
  <Input
    placeholder="Enter 6-character code from partner"
    maxLength={6}
    pattern="[A-Z0-9]{6}"
    onChange={handleCodeInput}
  />
  
  {mainAccountData && (
    <ConfirmationBox>
      <p>Your account will be set up as a partner device for:</p>
      <p>{mainAccountData.displayName}</p>
      <Checkbox>
        I understand my personal data will be cleared
      </Checkbox>
      <Button disabled={!confirmChecked}>
        Connect as Partner
      </Button>
    </ConfirmationBox>
  )}
</PartnerConnectionForm>
```

### 4. Session Data Migration

When partner account is created:
```tsx
// Frontend: Move personal sessions to archive
const handlePartnerAccountCreated = async (mainAccountUid) => {
  // Option 1: Keep personal sessions in isolated view
  // Option 2: Move to archive (recommended)
  
  // Personal sessions are wiped on backend, so:
  // 1. Clear local personal session list
  // 2. Show couple sessions only
  // 3. Show notification about data migration
}
```

---

## Security Considerations

### 1. Premium Validation
- Main account must be premium
- Enforced on backend before code generation
- Prevents free accounts from creating partner codes

### 2. Code Security
- 6-character alphanumeric (46,656 possible values)
- 24-hour expiration
- One-time use
- Case-insensitive for user convenience
- Rate limited: 5 codes/hour/IP

### 3. Data Protection
- Personal data wiped before conversion
- No accidental data leaks between accounts
- PIN inheritance ensures same encryption context
- Audit logging for all partnership operations

### 4. Account Isolation
- Partner accounts have limited role permissions
- Cannot generate their own connection codes
- Cannot modify main account settings
- Cannot delete main account

---

## Session Management

### What Happens When Partner Connects

**For Couple Sessions:**
- Partner account can now access couple sessions
- All encrypted couple session data accessible with inherited keys
- Personal messages from partner account visible in couple sessions

**For Personal Sessions:**
- All partner's personal sessions deleted
- Partner cannot access main account's personal sessions
- Personal chat history moves to new context

**For Chat History:**
- Personal sessions: Wiped, can be manually saved before connecting
- Couple sessions: Preserved, both accounts can access

---

## Testing Scenarios

### Test Case 1: Basic Connection
1. Main account generates code
2. Partner account uses code to connect
3. Verify partner account has correct mainAccountUid
4. Verify role is 'partner'
5. Verify PIN inherited
6. Verify personal data wiped

### Test Case 2: Code Expiration
1. Generate code
2. Wait 24+ hours (or manually set expiration)
3. Attempt connection with expired code
4. Verify 410 (Gone) response

### Test Case 3: Code Reuse Prevention
1. Generate code
2. Successfully connect partner account
3. Attempt to use same code again
4. Verify 409 (Conflict) response

### Test Case 4: Free Account Validation
1. Create free-tier account
2. Attempt to generate connection code
3. Verify 403 (Forbidden) response

### Test Case 5: Rate Limiting
1. Generate 5 codes in quick succession
2. Attempt 6th code
3. Verify 429 (Too Many Requests) response

---

## Migration Strategy

### Phase 1: Backend (✅ COMPLETE)
- API endpoints implemented
- Firestore rules updated
- Audit logging added
- Data wipeout logic implemented

### Phase 2: Frontend UI (UPCOMING)
- Registration flow update
- Connection code generation UI
- Partner connection input form
- Session migration handling
- Error messaging

### Phase 3: Testing & Polish
- Multi-device testing
- Edge case handling
- Performance optimization
- User documentation

### Phase 4: Deployment
- Gradual rollout
- Monitor error rates
- User support
- Gather feedback

---

## Error Handling

### Common Errors

| Status | Error | Cause | Resolution |
|--------|-------|-------|-----------|
| 400 | Invalid input | Malformed request | Check parameter format |
| 403 | Not premium | Main account free tier | Upgrade to premium |
| 404 | Code not found | Wrong code or typo | Double-check code |
| 404 | Account not found | Main account deleted | Use different account |
| 409 | Code already used | Previous connection succeeded | Generate new code |
| 410 | Code expired | >24 hours since generation | Generate new code |
| 429 | Too many codes | Rate limit exceeded | Wait 1 hour, try again |
| 500 | Server error | Database/service issue | Try again later |

---

## Future Enhancements

1. **Multiple Partner Devices**
   - Allow one main account with multiple partner devices
   - Manage which partner is synced in couple sessions

2. **Device Naming**
   - Name devices (e.g., "Bedroom iPad", "Kitchen Tablet")
   - Show which device last connected

3. **Cross-Device Sync**
   - Real-time sync of couple sessions across devices
   - Automatic session refresh

4. **Backup & Restore**
   - Allow automatic backup before partnership conversion
   - Restore previous personal data if needed

5. **Partnership Management**
   - Rename partner in settings
   - Update profile picture/info
   - Device history and activity logging

---

## Implementation Notes

### Key Decision: PIN Inheritance
PIN/KEK inheritance from main account was chosen because:
- ✅ Allows seamless encryption/decryption in same session
- ✅ No key exchange needed between devices
- ✅ Simpler UX (same PIN on both devices)
- ⚠️ Requires secure code transmission
- ⚠️ Both accounts use same KEK

### Alternative Considered: New PIN
- ❌ Partner would need separate PIN
- ❌ More complex key derivation for couple sessions
- ❌ Poor UX (different PIN on each device)

---

## Related Features

- **Account Linking** (Request-based, email invitation)
- **Premium Subscription** (Payment, tier validation)
- **Encryption System** (Key management, E2EE)
- **Session Management** (Couple vs. personal)
- **Audit Logging** (Security events)

---

## Commit History

- **be22e95**: Feature: Partner Device Account System - Phase 1 Backend
  - API endpoints for code generation and connection
  - Account data wipeout logic
  - Firestore rules and validators
  - Audit logging

---

**Last Updated:** March 23, 2026
**Status:** ✅ Backend Complete | ⏳ Frontend Pending
**Phase:** 1 Backend Implementation
