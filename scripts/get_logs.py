import paramiko
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

def get_logs():
    hostname = '100.88.227.10'
    username = 'ziegelimpresoras3D'
    password = '1752'

    print(f"Conectando a {hostname}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(hostname, username=username, password=password, timeout=10)
        print("Conectado exitosamente. Obteniendo logs...")
        
        # Ejecutar docker logs backend
        stdin, stdout, stderr = client.exec_command('cd printfarm-manager && docker compose logs backend --tail 50')
        
        for line in iter(stdout.readline, ""):
            print(line, end="")
            
        err = stderr.read().decode()
        if err:
            print("Errores:", err, file=sys.stderr)

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    get_logs()
