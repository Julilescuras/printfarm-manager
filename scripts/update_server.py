import paramiko
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

def update_server():
    hostname = '100.88.227.10'
    username = 'ziegelimpresoras3D'
    password = '1752'

    print(f"Conectando a {hostname}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(hostname, username=username, password=password, timeout=10)
        print("Conectado exitosamente. Ejecutando git pull && docker compose up -d --build...")
        
        # Ejecutar comandos directamente para ver donde falla
        # Ya no compilamos en el servidor: las imágenes se construyen en
        # GitHub Actions y se publican en GHCR. Acá solo se descargan.
        commands = [
            'cd printfarm-manager && git pull',
            'cd printfarm-manager && docker compose pull',
            'cd printfarm-manager && docker compose up -d'
        ]
        
        for cmd in commands:
            print(f"\n--- Ejecutando: {cmd} ---")
            stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
            
            # Non-blocking read loop
            stdout.channel.settimeout(1.0)
            while not stdout.channel.exit_status_ready():
                try:
                    if stdout.channel.recv_ready():
                        print(stdout.channel.recv(1024).decode('utf-8', errors='replace'), end='', flush=True)
                except Exception:
                    pass
                time.sleep(0.1)
                
            # print remaining
            while stdout.channel.recv_ready():
                print(stdout.channel.recv(1024).decode('utf-8', errors='replace'), end='', flush=True)

            exit_status = stdout.channel.recv_exit_status()
            print(f"\n[Status: {exit_status}]")
            if exit_status != 0:
                print("Error, abortando siguientes comandos.")
                break
        
    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    update_server()
