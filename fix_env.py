import paramiko
import sys

def fix_env():
    hostname = '100.88.227.10'
    username = 'ziegelimpresoras3D'
    password = '1752'

    print(f"Conectando a {hostname}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(hostname, username=username, password=password, timeout=10)
        
        # Reescribir .env con \n
        cmd = """
        cd printfarm-manager &&
        sed -i 's/\\r//g' .env &&
        sed -i 's/SPOOLMAN_URL=.*/SPOOLMAN_URL=http:\\/\\/printfarm-spoolman:8000/g' .env &&
        docker compose up -d backend
        """
        stdin, stdout, stderr = client.exec_command(cmd)
        print("Salida:", stdout.read().decode())
        print("Errores:", stderr.read().decode())

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    fix_env()
