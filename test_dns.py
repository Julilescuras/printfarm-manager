import paramiko
import sys

def test_dns():
    hostname = '100.88.227.10'
    username = 'ziegelimpresoras3D'
    password = '1752'

    print(f"Conectando a {hostname}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(hostname, username=username, password=password, timeout=10)
        
        # Ejecutar ping printfarm-spoolman dentro del contenedor
        stdin, stdout, stderr = client.exec_command('docker exec printfarm-backend ping -c 2 printfarm-spoolman')
        print("Salida de ping printfarm-spoolman:", stdout.read().decode())
        print("Errores de ping printfarm-spoolman:", stderr.read().decode())
        
        # Ejecutar ping spoolman dentro del contenedor
        stdin, stdout, stderr = client.exec_command('docker exec printfarm-backend ping -c 2 spoolman')
        print("Salida de ping spoolman:", stdout.read().decode())
        print("Errores de ping spoolman:", stderr.read().decode())

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    test_dns()
