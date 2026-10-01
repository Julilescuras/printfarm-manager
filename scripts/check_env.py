from _ssh import connect
import sys

def view_env():
    client = None
    try:
        client = connect()
        
        stdin, stdout, stderr = client.exec_command('cd printfarm-manager && cat -v .env | grep SPOOLMAN_URL')
        print("SPOOLMAN_URL in .env:", stdout.read().decode())

    except Exception as e:
        print(f"Error de conexión: {e}")
    finally:
        if client:
            client.close()

if __name__ == '__main__':
    view_env()
