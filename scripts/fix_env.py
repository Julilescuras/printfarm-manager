from _ssh import connect
import sys

def fix_env():
    client = None
    try:
        client = connect()
        
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
        if client:
            client.close()

if __name__ == '__main__':
    fix_env()
