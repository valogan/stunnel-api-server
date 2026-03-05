from database import SessionLocal, TunnelRecord

def view_tunnels():
    db = SessionLocal()
    records = db.query(TunnelRecord).all()
    
    if not records:
        print("The database is currently empty.")
        return

    header = f"{'ID':<4} | {'Stunnel ID':<38} | {'Source Agent':<15} | {'Dest Host':<15}"
    print(header)
    print("-" * len(header))
    
    for r in records:
        print(f"{r.id:<4} | {r.stunnel_id:<38} | {r.src_agent:<15} | {r.dst_host:<15}")
    
    db.close()

if __name__ == "__main__":
    view_tunnels()