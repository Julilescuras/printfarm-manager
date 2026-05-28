import paramiko
import sys

def view_env():
    hostname = '100.88.227.10'
    username = 'ziegelimpresoras3D'
    password = '1752'

    print(f"Conectando a {hostname}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(hostname, username=username, password=password, timeout=10)
        
        stdin, stdout, stderr = client.exec_command('cd printfarm-manager && cat -v .env | grep SPOOLMAN_URL')
        print("SPOOLMAN_URL in .env:", stdout.read().decode())

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    view_env()
